/**
 * Content manifest: every note in `notes/` and every PDF in `pdfs/`, with
 * metadata derived from the files themselves plus optional overrides from
 * `content.config.json`. "Last updated" comes from git history, so dates survive
 * a fresh CI checkout.
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { parseNote } from './note.mjs';
import { clamp, formatSize, linkKey, slugify, titleFromStem } from './text.mjs';

const run = promisify(execFile);

export const NOTES_DIR = 'notes';
export const RESOURCES_DIR = 'pdfs';
const CONFIG_FILE = 'content.config.json';
const DEFAULT_CATEGORY = 'General';

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
  return {
    site: { url: siteUrl, name: parsed.site?.name ?? 'InsightsMastery Academy' },
    defaults: parsed.defaults ?? {},
    rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    notes: parsed.notes ?? {},
    resources: parsed.resources ?? {},
  };
}

/** Overrides win, then the first matching rule, then the configured default. */
function resolveMeta(config, bucket, fileName) {
  const entry = config[bucket][fileName] ?? {};
  const rule =
    config.rules.find(
      (candidate) =>
        typeof candidate?.match === 'string' && fileName.toLowerCase().includes(candidate.match.toLowerCase())
    ) ?? {};
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
      const { meta, usedDefault } = resolveMeta(config, 'notes', file);
      if (usedDefault) warnings.push(`${relative} has no category — using "${meta.category}"`);
      if (!modified.fromGit) warnings.soft.push(`${relative} is not committed — using its file time`);
      const title = meta.title || parsed.title;
      return {
        slug: '',
        source: relative,
        title,
        kicker: parsed.kicker,
        description: meta.description ? clamp(meta.description) : parsed.description,
        category: meta.category,
        tags: meta.tags,
        words: parsed.words,
        minutes: parsed.minutes,
        bytes: stats.size,
        modified: modified.iso,
        sections: parsed.sections,
        headings: parsed.headings,
        bodyHtml: parsed.bodyHtml,
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
    const { meta, usedDefault } = resolveMeta(config, 'resources', file);
    if (usedDefault) warnings.push(`${relative} has no category — using "${meta.category}"`);
    if (!modified.fromGit) warnings.soft.push(`${relative} is not committed — using its file time`);
    const title = meta.title || titleFromStem(path.basename(file, path.extname(file)));
    resources.push({
      slug: uniqueSlug(slugify(title), used, file),
      file: relative,
      href: relative,
      title,
      description: meta.description
        ? clamp(meta.description)
        : `${title} — downloadable PDF (${formatSize(stats.size)}).`,
      category: meta.category,
      tags: meta.tags,
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
    note.pdf = resource.file;
  }
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
    lastUpdated,
  };
}

/**
 * @returns {{ config, notes, resources, site, warnings: string[] & { soft: string[] } }}
 * `notes[]` still carry `bodyHtml`/`source`; strip them with `publicManifest()`.
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

  const byTitle = (a, b) => a.title.localeCompare(b.title);
  notes.sort(byTitle);
  resources.sort(byTitle);
  return { config, notes, resources, site: summarise(notes, resources), warnings };
}

/** The JSON the browser loads: no article bodies, no source paths. */
export function publicManifest({ notes, resources, site }) {
  return {
    site,
    notes: notes.map(({ bodyHtml, source, ...note }) => note),
    resources,
  };
}
