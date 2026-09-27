/**
 * Build-time labelling with TypeSafe (System One).
 *
 * For every note and PDF the build asks, in one request:
 *   - category  Choice over the categories in content.config.json (+ "none")
 *   - level     Score on a Beginner → Intermediate → Advanced rubric
 *   - tag:<n>   one Noul per tag in the vocabulary ("is this a main topic?")
 *
 * Raw answers are cached by a hash of the exact state + questions, so each file
 * is judged once and every rebuild is deterministic; policy (thresholds, what
 * wins over what) lives in `manifest.mjs`, not in the cache. Without an API key,
 * or when the API fails, labelling is skipped and the build falls back to the
 * rules in content.config.json — publishing never depends on the API.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';

const CACHE_FILE = '.cache/typesafe-labels.json';
/** Bump when the questions change meaning, to invalidate cached answers. */
const QUESTIONS_VERSION = 1;
const CONCURRENCY = 4;
export const NO_CATEGORY = 'none';

export const LEVELS = [
  {
    label: 'Beginner',
    description: 'Beginner: assumes no prior Power BI, DAX or SQL experience and explains each concept and click step by step',
  },
  {
    label: 'Intermediate',
    description: 'Intermediate: assumes the reader already builds basic reports and teaches practical patterns and techniques',
  },
  {
    label: 'Advanced',
    description: 'Advanced: assumes solid modeling and DAX experience and covers edge cases, internals, performance or complex patterns',
  },
];

function questionsFor(categories, tags) {
  const questions = {
    category: choice(
      'Which category of this Power BI learning library does `document` mainly teach? Judge the main subject, not topics mentioned in passing.',
      { ...categories, [NO_CATEGORY]: 'None of the listed categories matches the main subject of the document' }
    ),
    level: score(
      'How advanced is the material in `document` for someone learning Power BI?',
      LEVELS.map((level) => level.description)
    ),
  };
  tags.forEach((tag, index) => {
    questions[`tag:${index}`] = noul(
      { tag, question: 'Is `tag` one of the main topics that `document` teaches?' },
      {
        true: 'The document spends substantial content explaining or applying `tag`',
        false: '`tag` is absent from the document or only mentioned in passing',
      }
    );
  });
  return questions;
}

/** Keep only what policy code needs; stable shape for the cache file. */
function compact(answers, tags) {
  return {
    category: {
      choice: answers.category.choice,
      confidence: answers.category.confidence,
      probabilities: answers.category.probabilities,
    },
    level: { score: answers.level.score, confidence: answers.level.confidence },
    tags: Object.fromEntries(tags.map((tag, index) => [tag, answers[`tag:${index}`].noul])),
  };
}

async function readCache(root) {
  try {
    return JSON.parse(await readFile(path.join(root, CACHE_FILE), 'utf8'));
  } catch {
    return {};
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * @param {string} root
 * @param {{ id: string, state: object }[]} items  `state.document` is the evidence
 * @param {{ categories: Record<string,string>, tags: string[], notes: string[] & {} }} options
 * @returns {Promise<{ answers: Map<string, object>, stats: { cached: number, fetched: number, skipped: string } }>}
 */
export async function labelItems(root, items, { categories, tags, notes }) {
  const answers = new Map();
  const stats = { cached: 0, fetched: 0, skipped: '' };
  if (!items.length || !Object.keys(categories).length) return { answers, stats };

  const questions = questionsFor(categories, tags);
  const cache = await readCache(root);
  const keyOf = (state) =>
    createHash('sha256').update(JSON.stringify({ v: QUESTIONS_VERSION, state, questions })).digest('hex');

  const pending = [];
  for (const item of items) {
    const key = keyOf(item.state);
    if (cache[key]) {
      answers.set(item.id, cache[key].answers);
      stats.cached += 1;
    } else {
      pending.push({ item, key });
    }
  }
  if (!pending.length) return { answers, stats };

  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    stats.skipped = `TYPESAFE_API_KEY not set — ${pending.length} file(s) use config rules`;
    return { answers, stats };
  }

  const client = new TypeSafeClient({ timeout: 20_000 });
  let failure = '';
  await mapLimit(pending, CONCURRENCY, async ({ item, key }) => {
    try {
      const response = await client.systemOne({ state: item.state, questions });
      const result = compact(response.answers, tags);
      cache[key] = { file: item.id, model: response.model, answers: result };
      answers.set(item.id, result);
      stats.fetched += 1;
    } catch (error) {
      failure ||= error instanceof Error ? error.message : String(error);
    }
  });
  if (failure) notes.push(`TypeSafe request failed (${failure}) — affected files use config rules`);

  if (stats.fetched) {
    await mkdir(path.dirname(path.join(root, CACHE_FILE)), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(path.join(root, CACHE_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
  }
  return { answers, stats };
}
