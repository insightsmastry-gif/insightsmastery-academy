#!/usr/bin/env node
/**
 * InsightsMastery Academy — content manifest builder.
 *
 * Scans `notes/*.html` and `pdfs/*.pdf`, derives metadata from the files
 * themselves (title, kicker, description, headings, word count, size, mtime),
 * merges optional overrides from `content.config.json` and writes
 * `content/manifest.json`. Every page on the site is driven by that file, so
 * dropping a new note or PDF on disk and re-running this script is the whole
 * publishing workflow — no code change, no hard-coded lists.
 *
 * Node 18+, ESM, zero dependencies. Runs from any working directory.
 *
 *   node scripts/build-manifest.mjs            build + write
 *   node scripts/build-manifest.mjs --check     build in memory, write nothing
 *   node scripts/build-manifest.mjs --quiet     suppress the summary
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_DIR = 'notes';
const RESOURCES_DIR = 'pdfs';
const CONFIG_FILE = 'content.config.json';
const OUTPUT_FILE = 'content/manifest.json';

const WORDS_PER_MINUTE = 210;
/**
 * Code blocks are skimmed, not read: a 300-word SQL listing does not cost the
 * same attention as 300 words of prose. Weighting `<pre>` text at 40% keeps the
 * estimate honest for handbooks that are half snippets.
 */
const CODE_WEIGHT = 0.4;
const DESCRIPTION_LIMIT = 220;
const DEFAULT_CATEGORY = 'General';

/** Filename-stem tokens that must not be title-cased. */
const ACRONYMS = new Map([
  ['POWERBI', 'Power BI'],
  ['BI', 'BI'],
  ['DAX', 'DAX'],
  ['SQL', 'SQL'],
  ['SOP', 'SOP'],
  ['SSMS', 'SSMS'],
  ['PDF', 'PDF'],
  ['ETL', 'ETL'],
  ['CSV', 'CSV'],
  ['API', 'API'],
]);

const ENTITIES = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"],
  ['bull', '\u2022'], ['nbsp', ' '], ['mdash', '\u2014'], ['ndash', '\u2013'],
  ['hellip', '\u2026'], ['rsquo', '\u2019'], ['lsquo', '\u2018'],
  ['rarr', '\u2192'], ['times', '\u00d7'], ['deg', '\u00b0'],
]);

/* ------------------------------------------------------------------ text ---- */

function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X'
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    const replacement = ENTITIES.get(name.toLowerCase());
    return replacement === undefined ? match : replacement;
  });
}

/** Markup -> plain, single-spaced text. */
function toText(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  const matches = text.match(/[^\s]+/g);
  return matches ? matches.length : 0;
}

function clamp(text, limit = DESCRIPTION_LIMIT) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  const head = (boundary > limit * 0.5 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.\u2013\u2014-]+$/, '');
  return `${head}\u2026`;
}

/** Mirrors `slugify()` in assets/js/content.js — ids must match at runtime. */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

/** Stem key used to pair a note with its PDF twin. */
function linkKey(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/insightsmastery/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const rendered = exponent === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${rendered} ${units[exponent]}`;
}

function posix(...parts) {
  return parts.join('/').replace(/\\/g, '/');
}

/* --------------------------------------------------------------- markup ---- */

const TOC_PATTERN = /<nav\b[^>]*class\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>[\s\S]*?<\/nav>/gi;

function firstMatch(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : '';
}

/** Inner HTML of the first `<tag class="… cls …">` block. */
function blockByClass(html, tag, cls) {
  const pattern = new RegExp(
    `<${tag}\\b[^>]*class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i',
  );
  return firstMatch(html, pattern);
}

function metaDescription(html) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/name\s*=\s*["']description["']/i.test(tag)) continue;
    const content = firstMatch(tag, /content\s*=\s*["']([\s\S]*?)["']/i);
    if (content.trim()) return toText(content);
  }
  return '';
}

const SKIP_COVER_CLASSES = /\b(kicker|sub|foot|lead)\b/i;

/** First descriptive `<p>` of `header.cover` (ignores kicker/sub/foot/lead). */
function coverParagraph(coverHtml) {
  const pattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pattern.exec(coverHtml)) !== null) {
    const classAttr = firstMatch(match[1], /class\s*=\s*["']([^"']*)["']/i);
    if (SKIP_COVER_CLASSES.test(classAttr)) continue;
    const text = toText(match[2]);
    if (text.length >= 24) return text;
  }
  return '';
}

function extractHeadings(mainHtml) {
  const pattern = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const used = new Set();
  const headings = [];
  let match;
  while ((match = pattern.exec(mainHtml)) !== null) {
    const text = toText(match[3]);
    if (!text) continue;
    let id = firstMatch(match[2], /\bid\s*=\s*["']([^"']+)["']/i).trim();
    if (!id) id = slugify(text) || `h-${headings.length + 1}`;
    let unique = id;
    let counter = 2;
    while (used.has(unique)) unique = `${id}-${counter++}`;
    used.add(unique);
    headings.push({ id: unique, text, level: Number(match[1]) });
  }
  return headings;
}

/** Everything derivable from a note's own HTML. */
function parseNote(html) {
  const rawTitle = toText(firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i))
    // Page titles end in the site suffix; the note name is what we want.
    .replace(/\s*[\u2013\u2014|-]\s*InsightsMastery(\s+Academy)?\s*$/i, '')
    .trim();
  const heading = toText(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i));
  const title = rawTitle || heading || 'Untitled note';

  const cover = blockByClass(html, 'header', 'cover');
  const kicker = toText(blockByClass(cover || html, 'p', 'kicker'));
  const lead = toText(blockByClass(html, 'p', 'lead'));

  let mainHtml = firstMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i) || html;
  const sections = (mainHtml.match(/<section\b[^>]*\bid\s*=\s*["'][^"']+["']/gi) || []).length;

  const readable = mainHtml
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(TOC_PATTERN, ' ');

  const headings = extractHeadings(readable);

  const codeBlocks = [];
  const prose = readable.replace(/<pre\b[\s\S]*?<\/pre>/gi, (block) => {
    codeBlocks.push(block);
    return ' ';
  });
  const words = countWords(toText(prose)) + Math.round(CODE_WEIGHT * countWords(toText(codeBlocks.join(' '))));
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));

  const description = clamp(
    metaDescription(html)
    || coverParagraph(cover)
    || lead
    || toText(firstMatch(readable, /<p\b[^>]*>([\s\S]*?)<\/p>/i))
    || `Handbook covering ${title}.`,
  );

  return { title, kicker, description, headings, sections, words, minutes };
}

/** `InsightsMastery_PowerBI_DAX_Handbook` -> `Power BI DAX Handbook`. */
function titleFromStem(stem) {
  return stem
    .replace(/^insightsmastery[_\-\s]*/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ACRONYMS.get(token.toUpperCase())
      ?? (/^[A-Z0-9]+$/.test(token) ? token : token[0].toUpperCase() + token.slice(1)))
    .join(' ')
    .trim() || stem;
}

/* --------------------------------------------------------------- config ---- */

async function loadConfig() {
  try {
    const parsed = JSON.parse(await readFile(path.join(ROOT, CONFIG_FILE), 'utf8'));
    return {
      defaults: parsed.defaults ?? {},
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      notes: parsed.notes ?? {},
      resources: parsed.resources ?? {},
    };
  } catch {
    // Missing or malformed config is not an error — the build is derivable.
    return { defaults: {}, rules: [], notes: {}, resources: {} };
  }
}

/**
 * Overrides win, then the first matching rule, then the configured default.
 * Returns `{ meta, usedDefault }` so the summary can flag unclassified files.
 */
function resolveMeta(config, bucket, fileName) {
  const entry = (config[bucket] ?? {})[fileName] ?? {};
  const rule = config.rules.find((candidate) => typeof candidate?.match === 'string'
    && fileName.toLowerCase().includes(candidate.match.toLowerCase())) ?? {};
  const category = entry.category ?? rule.category ?? config.defaults.category ?? DEFAULT_CATEGORY;
  const tags = (entry.tags ?? rule.tags ?? config.defaults.tags ?? [])
    .filter((tag) => typeof tag === 'string' && tag.trim())
    .map((tag) => tag.trim());
  return {
    meta: {
      category,
      tags: [...new Set(tags)],
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      title: typeof entry.title === 'string' ? entry.title.trim() : '',
    },
    usedDefault: !entry.category && !rule.category,
  };
}

/* ------------------------------------------------------------------ scan ---- */

async function listFiles(dir, extension) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, dir), { withFileTypes: true });
  } catch {
    return null; // directory absent
  }
  return entries
    .filter((entry) => entry.isFile()
      && !entry.name.startsWith('_')
      && !entry.name.startsWith('.')
      && entry.name.toLowerCase().endsWith(extension))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function uniqueSlug(candidate, used, fallback) {
  const base = candidate || slugify(fallback) || 'item';
  let slug = base;
  let counter = 2;
  while (used.has(slug)) slug = `${base}-${counter++}`;
  used.add(slug);
  return slug;
}

async function buildNotes(files, config, warnings) {
  const used = new Set();
  const notes = [];
  for (const file of files) {
    const relative = posix(NOTES_DIR, file);
    const absolute = path.join(ROOT, NOTES_DIR, file);
    const [html, stats] = await Promise.all([readFile(absolute, 'utf8'), stat(absolute)]);
    const parsed = parseNote(html);
    const { meta, usedDefault } = resolveMeta(config, 'notes', file);
    if (usedDefault) warnings.push(`${relative} has no category — using "${meta.category}"`);
    const title = meta.title || parsed.title;
    const slug = uniqueSlug(slugify(title), used, file);
    notes.push({
      slug,
      file: relative,
      href: `note.html?note=${slug}`,
      title,
      kicker: parsed.kicker,
      description: meta.description ? clamp(meta.description) : parsed.description,
      category: meta.category,
      tags: meta.tags,
      words: parsed.words,
      minutes: parsed.minutes,
      readingTime: `${parsed.minutes} min read`,
      bytes: stats.size,
      modified: stats.mtime.toISOString(),
      sections: parsed.sections,
      headings: parsed.headings,
      pdf: null,
    });
  }
  return notes;
}

async function buildResources(files, config, warnings) {
  const used = new Set();
  const resources = [];
  for (const file of files) {
    const relative = posix(RESOURCES_DIR, file);
    const stats = await stat(path.join(ROOT, RESOURCES_DIR, file));
    const { meta, usedDefault } = resolveMeta(config, 'resources', file);
    if (usedDefault) warnings.push(`${relative} has no category — using "${meta.category}"`);
    const title = meta.title || titleFromStem(path.basename(file, path.extname(file)));
    const slug = uniqueSlug(slugify(title), used, file);
    resources.push({
      slug,
      file: relative,
      href: relative,
      title,
      description: meta.description ? clamp(meta.description) : `${title} — downloadable PDF (${formatSize(stats.size)}).`,
      category: meta.category,
      tags: meta.tags,
      bytes: stats.size,
      size: formatSize(stats.size),
      modified: stats.mtime.toISOString(),
      ext: 'pdf',
      note: null,
    });
  }
  return resources;
}

function crossLink(notes, resources) {
  const notesByKey = new Map(notes.map((note) => [linkKey(note.file), note]));
  for (const resource of resources) {
    const note = notesByKey.get(linkKey(resource.file));
    if (!note) continue;
    resource.note = note.slug;
    note.pdf = resource.file;
  }
}

function summarise(notes, resources, generatedAt) {
  const categories = new Set();
  const tags = new Set();
  let totalWords = 0;
  let totalMinutes = 0;
  let totalBytes = 0;
  let lastUpdated = '';

  for (const item of [...notes, ...resources]) {
    if (item.category) categories.add(item.category);
    for (const tag of item.tags) tags.add(tag);
    totalBytes += item.bytes;
    if (item.modified > lastUpdated) lastUpdated = item.modified;
  }
  for (const note of notes) {
    totalWords += note.words;
    totalMinutes += note.minutes;
  }

  return {
    noteCount: notes.length,
    resourceCount: resources.length,
    totalWords,
    totalMinutes,
    totalBytes,
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
    tags: [...tags].sort((a, b) => a.localeCompare(b)),
    lastUpdated: lastUpdated || generatedAt,
  };
}

async function build() {
  const config = await loadConfig();
  const warnings = [];
  const [noteFiles, resourceFiles] = await Promise.all([
    listFiles(NOTES_DIR, '.html'),
    listFiles(RESOURCES_DIR, '.pdf'),
  ]);

  if (noteFiles === null && resourceFiles === null) {
    throw new Error(`Neither ${NOTES_DIR}/ nor ${RESOURCES_DIR}/ exists in ${ROOT} — nothing to build.`);
  }
  if (noteFiles === null) warnings.push(`${NOTES_DIR}/ is missing — no notes in this build`);
  if (resourceFiles === null) warnings.push(`${RESOURCES_DIR}/ is missing — no downloads in this build`);

  const notes = await buildNotes(noteFiles ?? [], config, warnings);
  const resources = await buildResources(resourceFiles ?? [], config, warnings);
  crossLink(notes, resources);

  const byTitle = (a, b) => a.title.localeCompare(b.title);
  notes.sort(byTitle);
  resources.sort(byTitle);

  const generatedAt = new Date().toISOString();
  return {
    manifest: { generatedAt, site: summarise(notes, resources, generatedAt), notes, resources },
    warnings,
  };
}

function report({ manifest, warnings }, { check }) {
  const { site } = manifest;
  const words = site.totalWords.toLocaleString('en-US');
  console.log('InsightsMastery Academy — content manifest');
  console.log(`  notes       ${site.noteCount}  (${words} words · ${site.totalMinutes} min reading)`);
  console.log(`  resources   ${site.resourceCount}  (${formatSize(site.totalBytes)} on disk)`);
  console.log(`  categories  ${site.categories.join(', ') || '—'}`);
  console.log(`  tags        ${site.tags.length} unique · updated ${site.lastUpdated}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log(check ? '  --check: nothing written' : `  → ${OUTPUT_FILE}`);
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const quiet = args.includes('--quiet') || args.includes('-q');

  const result = await build();
  if (!check) {
    const target = path.join(ROOT, OUTPUT_FILE);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  }
  if (!quiet) report(result, { check });
}

try {
  await main();
} catch (error) {
  console.error(`build-manifest: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
