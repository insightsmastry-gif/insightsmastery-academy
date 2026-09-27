#!/usr/bin/env node
/**
 * Verifies a built `_site/` before it is deployed:
 *
 *   - every local href/src (pages, note pages, CSS url(), JS imports) resolves
 *   - every same-page `#fragment` link has a matching id
 *   - every page carries a Content-Security-Policy and exactly one <h1>
 *   - JSON-LD blocks parse; sitemap and manifest entries resolve
 *   - nothing outside the publish allowlist leaked in (README, scripts, config…)
 *
 *   node scripts/check-site.mjs      exit 1 and list every problem
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '_site');
const FORBIDDEN = /^(?:README\.md|package(?:-lock)?\.json|content\.config\.json|scripts\/|templates\/|node_modules\/|notes\/[^/]+\.html$|\.github\/)/;
const EXEMPT_H1 = new Set(['note.html']);

const config = JSON.parse(await readFile(path.join(ROOT, 'content.config.json'), 'utf8'));
const SITE_URL = config.site.url;
const BASE_PATH = new URL(SITE_URL).pathname;

const problems = [];
const fail = (file, message) => problems.push(`${file}: ${message}`);

async function walk(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), `${relative}/`)));
    else out.push(relative);
  }
  return out;
}

async function exists(relative) {
  try {
    const stats = await stat(path.join(SITE, relative));
    if (stats.isFile()) return true;
    return (await stat(path.join(SITE, relative, 'index.html'))).isFile();
  } catch {
    return false;
  }
}

/** Site-relative target of a reference found in `from`, or null when it is not local. */
function target(from, reference) {
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) return null;
  const [pathPart] = reference.split(/[?#]/);
  if (!pathPart) return null; // pure fragment or query
  if (pathPart.startsWith('/')) {
    return pathPart.startsWith(BASE_PATH) ? decodeURIComponent(pathPart.slice(BASE_PATH.length)) : `\0${pathPart}`;
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURIComponent(pathPart)));
  return resolved.startsWith('..') ? `\0${reference}` : resolved;
}

async function checkReference(file, reference) {
  const resolved = target(file, reference);
  if (resolved === null) return;
  if (resolved.startsWith('\0') || !(await exists(resolved))) fail(file, `broken link ${reference}`);
}

async function checkHtml(file) {
  const $ = cheerio.load(await readFile(path.join(SITE, file), 'utf8'));
  if (!$('meta[http-equiv="Content-Security-Policy"]').attr('content')) fail(file, 'missing Content-Security-Policy');
  if (!EXEMPT_H1.has(file) && $('h1').length !== 1) fail(file, `expected one <h1>, found ${$('h1').length}`);

  const ids = new Set($('[id]').map((_, el) => $(el).attr('id')).get());
  for (const el of $('[href], [src]').toArray()) {
    for (const attribute of ['href', 'src']) {
      const value = $(el).attr(attribute);
      if (value === undefined) continue;
      if (value.startsWith('#') && value.length > 1 && !ids.has(decodeURIComponent(value.slice(1)))) {
        fail(file, `fragment ${value} has no matching id`);
      }
      await checkReference(file, value);
    }
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      JSON.parse($(el).html() ?? '');
    } catch (error) {
      fail(file, `invalid JSON-LD: ${error.message}`);
    }
  });
}

async function checkCss(file) {
  const css = await readFile(path.join(SITE, file), 'utf8');
  for (const [, , reference] of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
    await checkReference(file, reference);
  }
}

async function checkJs(file) {
  const code = await readFile(path.join(SITE, file), 'utf8');
  for (const [, , reference] of code.matchAll(/(?:\bfrom\s*|^\s*import\s*)(['"])(\.\/[^'"]+)\1/gm)) {
    await checkReference(file, reference);
  }
}

async function main() {
  const files = await walk(SITE);
  for (const file of files) {
    if (FORBIDDEN.test(file)) fail(file, 'must not be published');
    if (file.endsWith('.html')) await checkHtml(file);
    else if (file.endsWith('.css')) await checkCss(file);
    else if (file.endsWith('.js')) await checkJs(file);
  }

  // Manifest URLs are relative to the site root (the pages that consume them live there).
  const manifest = JSON.parse(await readFile(path.join(SITE, 'content/manifest.json'), 'utf8'));
  for (const item of [...manifest.notes, ...manifest.resources]) {
    await checkReference('index.html', item.href);
    if (item.pdf) await checkReference('index.html', item.pdf);
  }

  const sitemap = await readFile(path.join(SITE, 'sitemap.xml'), 'utf8');
  for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    if (!loc.startsWith(SITE_URL)) fail('sitemap.xml', `foreign URL ${loc}`);
    else if (!(await exists(loc.slice(SITE_URL.length)))) fail('sitemap.xml', `missing page ${loc}`);
  }

  if (problems.length) {
    console.error(`check-site: ${problems.length} problem(s)`);
    problems.forEach((problem) => console.error(`  ✗ ${problem}`));
    process.exitCode = 1;
  } else {
    console.log(`check-site: ${files.length} files OK`);
  }
}

await main();
