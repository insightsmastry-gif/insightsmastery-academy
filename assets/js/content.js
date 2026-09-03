/**
 * Content access layer.
 *
 * The site is fully static: `scripts/build-manifest.mjs` scans /notes and
 * /pdfs at build time and writes `content/manifest.json`. Nothing here
 * hard-codes a note or a PDF — every list is derived from that manifest.
 */

const MANIFEST_URL = 'content/manifest.json';

/** Thrown when the manifest cannot be loaded or is malformed. */
export class ContentError extends Error {
  constructor(message, { cause, hint } = {}) {
    super(message);
    this.name = 'ContentError';
    this.cause = cause;
    this.hint = hint ?? 'Run `npm run build` to regenerate content/manifest.json.';
  }
}

let cache = null;

/**
 * Resolve any repo-relative path (e.g. 'content/manifest.json', 'notes/x.html')
 * relative to the site root, using this module's own location as the anchor.
 * This prevents 404s when the site is opened without trailing slashes or in sub-paths.
 */
export function resolveAssetUrl(relativePath) {
  const clean = String(relativePath || '').replace(/^\/+/, '');
  try {
    return new URL(`../../${clean}`, import.meta.url).href;
  } catch {
    return clean;
  }
}

/**
 * Fetch + cache the content manifest.
 * @param {{ base?: string }} [options] optional explicit base override
 * @returns {Promise<import('./types.js').Manifest>}
 */
export async function loadManifest(options = {}) {
  if (cache) return cache;
  const url = options.base ? `${options.base}${MANIFEST_URL}` : resolveAssetUrl(MANIFEST_URL);
  let response;
  try {
    response = await fetch(url, { cache: 'no-cache' });
  } catch (error) {
    throw new ContentError('Could not reach the content manifest.', {
      cause: error,
      hint:
        window.location.protocol === 'file:'
          ? 'Open the site through a web server (npm start) — browsers block fetch() on file:// URLs.'
          : undefined,
    });
  }
  if (!response.ok) {
    throw new ContentError(`Content manifest returned HTTP ${response.status} (tried ${url}).`);
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new ContentError('Content manifest is not valid JSON.', { cause: error });
  }
  if (!data || !Array.isArray(data.notes) || !Array.isArray(data.resources)) {
    throw new ContentError('Content manifest is missing the notes/resources arrays.');
  }
  cache = data;
  return cache;
}

/** @returns {Promise<import('./types.js').Note[]>} */
export async function getNotes() {
  return (await loadManifest()).notes;
}

/** @returns {Promise<import('./types.js').Resource[]>} */
export async function getResources() {
  return (await loadManifest()).resources;
}

/** Look up one note by slug. */
export async function getNote(slug) {
  return (await getNotes()).find((note) => note.slug === slug) ?? null;
}

// --- formatting helpers ------------------------------------------------------

/** 1536 -> "1.5 KB" */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const digits = value >= 10 || exponent === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[exponent]}`;
}

/** ISO date -> "12 Mar 2026" */
export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** ISO date -> "3 days ago" (falls back to absolute for old dates) */
export function formatRelative(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const steps = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2629800],
  ];
  if (Math.abs(seconds) < 60) return 'just now';
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) < size * (unit === 'month' ? 12 : unit === 'week' ? 4.5 : 60)) {
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return formatDate(iso);
}

/** 7 -> "7 min read" */
export function readingLabel(minutes) {
  const value = Math.max(1, Math.round(minutes || 1));
  return `${value} min read`;
}

/** Slug-safe id from arbitrary text. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

/** Escape untrusted text before it touches innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

/** Trailing-edge debounce. */
export function debounce(fn, wait = 160) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Case/diacritic-insensitive substring match across several fields.
 * @param {string} query
 * @param {string[]} fields
 */
export function matchesQuery(query, fields) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = fields.filter(Boolean).join(' ').toLowerCase();
  return needle.split(/\s+/).every((term) => haystack.includes(term));
}

/** Highlight query terms inside already-escaped text. */
export function highlight(escapedText, query) {
  const terms = query.trim().split(/\s+/).filter((term) => term.length > 1);
  if (!terms.length) return escapedText;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return escapedText.replace(pattern, '<mark class="mark">$1</mark>');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
