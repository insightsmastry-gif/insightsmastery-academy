/**
 * Content manifest: every note in `notes/` and every PDF in `pdfs/`, with
 * metadata derived from the files themselves, TypeSafe labels (category, level,
 * tags) and optional overrides from `content.config.json`. "Last updated" comes
 * from git history, so dates survive a fresh CI checkout.
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { LEVELS, NO_CATEGORY, labelItems } from './labels.mjs';
import { parseNote } from './note.mjs';
import { clamp, formatSize, linkKey, slugify, titleFromStem } from './text.mjs';

const run = promisify(execFile);

export const NOTES_DIR = 'notes';
export const RESOURCES_DIR = 'pdfs';
const CONFIG_FILE = 'content.config.json';
const DEFAULT_CATEGORY = 'General';

/**
 * Label policy. Thresholds gate how much a TypeSafe judgment must be trusted
 * before it overrides the filename rules; tune them against real uploads.
 */
const POLICY = {
  categoryConfidence: 0.5,
  levelConfidence: 0.4,
  tagProbability: 0.7,
  maxTags: 5,
};

/** ISO date of the last commit touching `file`; mtime when the file is not committed yet. */
async function lastModified(root, relative) {
  try {
    const { stdout } = await run('git', ['log', '-1', '--format=%cI', '--', relative], { cwd: root });
    const iso = stdout.trim();
    if (iso) return { iso: new Date(iso).toISOString(), fromGit: true };
  } catch {
    /* not a git checkout — fall through */
  }
  const stats = await stat(path.join(root, relative));
  return { iso: stats.mtime.toISOString(), fromGit: false };
}

const cleanTags = (tags) => [
  ...new Set((Array.isArray(tags) ? tags : []).filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim())),
];

export async function loadConfig(root) {
  let parsed = {};
  try {
    parsed = JSON.parse(await readFile(path.join(root, CONFIG_FILE), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`${CONFIG_FILE} is not valid JSON: ${error.message}`);
  }
  const siteUrl = parsed.site?.url;
  if (typeof siteUrl !== 'string' || !/^https?:\/\/.+\/$/.test(siteUrl)) {
    throw new Error(`${CONFIG_FILE} must set site.url to an absolute URL ending in "/"`);
  }
  const config = {
    site: { url: siteUrl, name: parsed.site?.name ?? 'InsightsMastery Academy' },
    categories: parsed.categories && typeof parsed.categories === 'object' ? parsed.categories : {},
    defaults: parsed.defaults ?? {},
    rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    notes: parsed.notes ?? {},
    resources: parsed.resources ?? {},
  };
  // Tag vocabulary for labelling: every tag the config already uses.
  config.tagVocabulary = cleanTags([
    ...config.rules.flatMap((rule) => rule.tags ?? []),
    ...Object.values(config.notes).flatMap((entry) => entry.tags ?? []),
    ...Object.values(config.resources).flatMap((entry) => entry.tags ?? []),
  ]).sort((a, b) => a.localeCompare(b));
  return config;
}

function entryFor(config, bucket, fileName) {
  return config[bucket][fileName] ?? {};
}

function ruleFor(config, fileName) {
  return (
    config.rules.find(
      (candidate) =>
        typeof candidate?.match === 'string' && fileName.toLowerCase().includes(candidate.match.toLowerCase())
    ) ?? {}
  );
}

/**
 * Category, tags and level for one file. Precedence per field:
 * config entry → confident TypeSafe answer → first matching rule → default.
 */
function classify(config, bucket, fileName, labels) {
  const entry = entryFor(config, bucket, fileName);
  const rule = ruleFor(config, fileName);

  const tsCategory =
    labels &&
    labels.category.choice !== NO_CATEGORY &&
    labels.category.confidence >= POLICY.categoryConfidence &&
    Object.hasOwn(config.categories, labels.category.choice)
      ? labels.category.choice
      : null;
  const category = entry.category ?? tsCategory ?? rule.category ?? config.defaults.category ?? DEFAULT_CATEGORY;

  const tsTags = labels
    ? Object.entries(labels.tags)
        .filter(([, probability]) => probability >= POLICY.tagProbability)
        .sort(([, a], [, b]) => b - a)
        .slice(0, POLICY.maxTags)
        .map(([tag]) => tag)
    : [];
  const tags = cleanTags(entry.tags ?? (tsTags.length ? tsTags : null) ?? rule.tags ?? config.defaults.tags);

  const levelIndex = labels && labels.level.confidence >= POLICY.levelConfidence ? Math.round(labels.level.score) : -1;
  const level =
    typeof entry.level === 'string' && entry.level.trim() ? entry.level.trim() : (LEVELS[levelIndex]?.label ?? null);

  return {
    category,
    tags,
    level,
    usedDefault: !entry.category && !tsCategory && !rule.category,
  };
}

async function listFiles(root, dir, extension) {
  let entries;
  try {
    entries = await readdir(path.join(root, dir), { withFileTypes: true });
  } catch {
    return null;
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith('_') &&
        !entry.name.startsWith('.') &&
        entry.name.toLowerCase().endsWith(extension)
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function uniqueSlug(candidate, used, fallback) {
  const base = candidate || slugify(fallback) || 'item';
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

async function buildNotes(root, files, config, warnings) {
  const notes = await Promise.all(
    files.map(async (file) => {
      const relative = `${NOTES_DIR}/${file}`;
      const [html, stats, modified] = await Promise.all([
        readFile(path.join(root, relative), 'utf8'),
        stat(path.join(root, relative)),
        lastModified(root, relative),
      ]);
      const parsed = parseNote(html);
      const entry = entryFor(config, 'notes', file);
      if (!modified.fromGit) warnings.soft.push(`${relative} is not committed — using its file time`);
      return {
        slug: '',
        fileName: file,
        source: relative,
        title: (typeof entry.title === 'string' && entry.title.trim()) || parsed.title,
        kicker: parsed.kicker,
        description: typeof entry.description === 'string' && entry.description.trim() ? clamp(entry.description.trim()) : parsed.description,
        category: '',
        tags: [],
        level: null,
        words: parsed.words,
        minutes: parsed.minutes,
        bytes: stats.size,
        modified: modified.iso,
        sections: parsed.sections,
        headings: parsed.headings,
        bodyHtml: parsed.bodyHtml,
        excerpt: parsed.excerpt,
        pdf: null,
      };
    })
  );
  // Assign slugs in file order so duplicates resolve the same way on every build.
  const used = new Set();
  for (const [index, note] of notes.entries()) {
    note.slug = uniqueSlug(slugify(note.title), used, files[index]);
    note.href = `notes/${note.slug}/`;
  }
  return notes;
}

async function buildResources(root, files, config, warnings) {
  const used = new Set();
  const resources = [];
  for (const file of files) {
    const relative = `${RESOURCES_DIR}/${file}`;
    const [stats, modified] = await Promise.all([stat(path.join(root, relative)), lastModified(root, relative)]);
    const entry = entryFor(config, 'resources', file);
    if (!modified.fromGit) warnings.soft.push(`${relative} is not committed — using its file time`);
    const title = (typeof entry.title === 'string' && entry.title.trim()) || titleFromStem(path.basename(file, path.extname(file)));
    resources.push({
      slug: uniqueSlug(slugify(title), used, file),
      fileName: file,
      file: relative,
      href: relative,
      title,
      description:
        typeof entry.description === 'string' && entry.description.trim()
          ? clamp(entry.description.trim())
          : `${title} — downloadable PDF (${formatSize(stats.size)}).`,
      category: '',
      tags: [],
      level: null,
      bytes: stats.size,
      size: formatSize(stats.size),
      modified: modified.iso,
      ext: 'pdf',
      note: null,
    });
  }
  return resources;
}

function crossLink(notes, resources) {
  const notesByKey = new Map(notes.map((note) => [linkKey(note.source), note]));
  for (const resource of resources) {
    const note = notesByKey.get(linkKey(resource.file));
    if (!note) continue;
    resource.note = note.slug;
    resource.noteHref = note.href;
    resource.twin = note;
    note.pdf = resource.file;
  }
}

/** What TypeSafe sees. A PDF with a note twin is judged on the note's text. */
function noteEvidence(note) {
  return {
    document: {
      kind: 'handbook',
      title: note.title,
      description: note.description,
      headings: note.headings.map((heading) => heading.text).slice(0, 80),
      opening_text: note.excerpt,
    },
  };
}

function resourceEvidence(resource) {
  if (resource.twin) return noteEvidence(resource.twin);
  return {
    document: {
      kind: 'downloadable PDF (only its file name and description are available)',
      title: resource.title,
      file_name: resource.fileName,
      description: resource.description,
    },
  };
}

async function applyLabels(root, config, notes, resources, warnings) {
  const items = [
    ...notes.map((note) => ({ id: note.source, state: noteEvidence(note) })),
    ...resources.map((resource) => ({ id: resource.file, state: resourceEvidence(resource) })),
  ];
  const { answers, stats } = await labelItems(root, items, {
    categories: config.categories,
    tags: config.tagVocabulary,
    notes: warnings.soft,
  });
  if (stats.skipped) warnings.soft.push(stats.skipped);

  const assign = (item, bucket, id) => {
    const result = classify(config, bucket, item.fileName, answers.get(id));
    item.category = result.category;
    item.tags = result.tags;
    item.level = result.level;
    if (result.usedDefault) warnings.push(`${id} has no category — using "${result.category}"`);
  };
  notes.forEach((note) => assign(note, 'notes', note.source));
  resources.forEach((resource) => assign(resource, 'resources', resource.file));
  return stats;
}

function summarise(notes, resources) {
  const categories = new Set();
  const tags = new Set();
  let lastUpdated = '';
  for (const item of [...notes, ...resources]) {
    categories.add(item.category);
    item.tags.forEach((tag) => tags.add(tag));
    if (item.modified > lastUpdated) lastUpdated = item.modified;
  }
  return {
    noteCount: notes.length,
    resourceCount: resources.length,
    totalWords: notes.reduce((sum, note) => sum + note.words, 0),
    totalMinutes: notes.reduce((sum, note) => sum + note.minutes, 0),
    totalBytes: [...notes, ...resources].reduce((sum, item) => sum + item.bytes, 0),
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
    tags: [...tags].sort((a, b) => a.localeCompare(b)),
    levels: LEVELS.map((level) => level.label),
    lastUpdated,
  };
}

/**
 * @returns {{ config, notes, resources, site, labelStats, warnings: string[] & { soft: string[] } }}
 * Notes/resources still carry build-only fields; strip them with `publicManifest()`.
 */
export async function buildContent(root) {
  const config = await loadConfig(root);
  const warnings = Object.assign([], { soft: [] });
  const [noteFiles, resourceFiles] = await Promise.all([
    listFiles(root, NOTES_DIR, '.html'),
    listFiles(root, RESOURCES_DIR, '.pdf'),
  ]);
  if (noteFiles === null && resourceFiles === null) {
    throw new Error(`Neither ${NOTES_DIR}/ nor ${RESOURCES_DIR}/ exists in ${root} — nothing to build.`);
  }
  if (noteFiles === null) warnings.push(`${NOTES_DIR}/ is missing — no notes in this build`);
  if (resourceFiles === null) warnings.push(`${RESOURCES_DIR}/ is missing — no downloads in this build`);

  const notes = await buildNotes(root, noteFiles ?? [], config, warnings);
  const resources = await buildResources(root, resourceFiles ?? [], config, warnings);
  crossLink(notes, resources);
  const labelStats = await applyLabels(root, config, notes, resources, warnings);

  const byTitle = (a, b) => a.title.localeCompare(b.title);
  notes.sort(byTitle);
  resources.sort(byTitle);
  return { config, notes, resources, site: summarise(notes, resources), labelStats, warnings };
}

/** The JSON the browser loads: no article bodies, source paths or build-only fields. */
export function publicManifest({ notes, resources, site }) {
  return {
    site,
    notes: notes.map(({ bodyHtml, source, fileName, excerpt, ...note }) => note),
    resources: resources.map(({ fileName, twin, ...resource }) => resource),
  };
}
