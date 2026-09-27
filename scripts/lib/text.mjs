/** Plain-text helpers shared by the build. */

import path from 'node:path';

const DESCRIPTION_LIMIT = 220;

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

export function countWords(text) {
  const matches = String(text).match(/[^\s]+/g);
  return matches ? matches.length : 0;
}

export function clamp(text, limit = DESCRIPTION_LIMIT) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  const head = (boundary > limit * 0.5 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.\u2013\u2014-]+$/, '');
  return `${head}\u2026`;
}

/** URL/id-safe slug: lower-case ASCII words joined by hyphens, max 72 chars. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

/** Stem key used to pair a note with its PDF twin. */
export function linkKey(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/insightsmastery/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const rendered = exponent === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${rendered} ${units[exponent]}`;
}

/** `InsightsMastery_PowerBI_DAX_Handbook` -> `Power BI DAX Handbook`. */
export function titleFromStem(stem) {
  return (
    stem
      .replace(/^insightsmastery[_\-\s]*/i, '')
      .replace(/[_\-]+/g, ' ')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean)
      .map(
        (token) =>
          ACRONYMS.get(token.toUpperCase()) ??
          (/^[A-Z0-9]+$/.test(token) ? token : token[0].toUpperCase() + token.slice(1))
      )
      .join(' ')
      .trim() || stem
  );
}

/** Escape text for HTML text nodes and double-quoted attributes. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
