#!/usr/bin/env node
/**
 * InsightsMastery Academy — static site build.
 *
 * Reads the source tree (root pages, `templates/`, `assets/`, `notes/`,
 * `pdfs/`, `content.config.json`) and writes the deployable site to `_site/`:
 *
 *   - `content/manifest.json`   index of notes + PDFs (no article bodies)
 *   - `notes/<slug>/index.html` one prerendered, sanitised page per handbook
 *   - `note.html`               redirect for old `note.html?note=<slug>` links
 *   - pages with one content-hashed CSS bundle, content-hashed JS modules and
 *     a per-page Content-Security-Policy
 *   - `sitemap.xml`, `robots.txt`, `.nojekyll`, PDFs, fonts and images
 *
 * Only files listed here are published; README, scripts and config stay private.
 *
 *   node scripts/build.mjs           build _site/
 *   node scripts/build.mjs --check   validate content only, write nothing
 *   node scripts/build.mjs --quiet   no summary
 */

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';

import { buildContent, publicManifest } from './lib/manifest.mjs';
import { escapeHtml, formatSize } from './lib/text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = '_site';
const OUT = path.join(ROOT, OUT_DIR);

const PAGES = ['index.html', 'notes.html', 'resources.html', 'about.html', '404.html'];
const NOTE_TEMPLATE = 'templates/note.html';
const COPY = ['assets/images', 'assets/fonts', 'pdfs'];

const sha = (data, length = 10) => createHash('sha256').update(data).digest('hex').slice(0, length);
const cspHash = (source) => `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`;

/* ------------------------------------------------------------- assets ---- */

/** Static `import … from './x.js'` and side-effect `import './x.js'` (JSDoc `import()` types are ignored). */
const IMPORT_PATTERN = /(\bfrom\s*|^\s*import\s*)(['"])\.\/([\w.-]+\.js)\2/gm;

/** Content-hash every module; a module's hash covers the hashed names of its imports. */
async function hashModules() {
  const dir = path.join(ROOT, 'assets/js');
  const sources = new Map();
  for (const name of (await readdir(dir)).filter((file) => file.endsWith('.js'))) {
    sources.set(name, await readFile(path.join(dir, name), 'utf8'));
  }
  const hashed = new Map();
  const visiting = new Set();
  const resolve = (name) => {
    if (hashed.has(name)) return hashed.get(name);
    if (!sources.has(name)) throw new Error(`assets/js imports a missing module: ${name}`);
    if (visiting.has(name)) throw new Error(`assets/js has an import cycle through ${name}`);
    visiting.add(name);
    const code = sources
      .get(name)
      .replace(IMPORT_PATTERN, (_, lead, quote, dep) => `${lead}${quote}./${resolve(dep).file}${quote}`);
    visiting.delete(name);
    const entry = { file: `${name.replace(/\.js$/, '')}.${sha(code)}.js`, code };
    hashed.set(name, entry);
    return entry;
  };
  [...sources.keys()].forEach(resolve);
  return hashed;
}

/* --------------------------------------------------------------- urls ---- */

function createUrlTools(siteUrl) {
  const basePath = new URL(siteUrl).pathname; // "/insightsmastery-academy/"
  /** Source reference -> site-relative path ("assets/css/base.css"), or null if not local. */
  const local = (value) => {
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value)) return null;
    if (value.startsWith(basePath)) return value.slice(basePath.length);
    if (value.startsWith('/')) return null;
    return value.replace(/^\.\//, '');
  };
  return { basePath, local };
}

/* -------------------------------------------------------------- pages ---- */

const INLINE_SCRIPT = 'script:not([src]):not([type="application/ld+json"])';

function csp($) {
  const hashes = $(INLINE_SCRIPT)
    .map((_, el) => cspHash($(el).html() ?? ''))
    .get();
  return [
    "default-src 'self'",
    `script-src 'self'${hashes.length ? ` ${[...new Set(hashes)].join(' ')}` : ''}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** Must run last: the policy hashes the final inline scripts. */
function addSecurityMeta($) {
  $('meta[http-equiv="Content-Security-Policy"], meta[name="referrer"]').remove();
  $('meta[charset]').after(
    `\n<meta http-equiv="Content-Security-Policy" content="${csp($)}">` +
      '\n<meta name="referrer" content="strict-origin-when-cross-origin">'
  );
}

function jsonLd(data) {
  // `<` is escaped so note titles can never close the script element.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/**
 * Rewrite a parsed page for publishing: one CSS bundle, hashed modules, and every
 * local URL re-anchored with `prefix` ("" for root pages, "../../" for note pages,
 * the base path for 404.html, which Pages serves at arbitrary depths).
 */
async function publishAssets($, { prefix, urls, modules, bundles }) {
  const sheetLinks = $('link[rel="stylesheet"]').filter((_, el) => urls.local($(el).attr('href')) !== null);
  const moduleScripts = $('script[type="module"][src]');

  $('[href], [src]')
    .not(sheetLinks)
    .not(moduleScripts)
    .each((_, el) => {
      for (const attribute of ['href', 'src']) {
        const target = urls.local($(el).attr(attribute));
        if (target !== null) $(el).attr(attribute, `${prefix}${target}`);
      }
    });

  if (sheetLinks.length) {
    const sheets = sheetLinks.map((_, el) => urls.local($(el).attr('href'))).get();
    const key = sheets.join('|');
    if (!bundles.has(key)) {
      const css = (await Promise.all(sheets.map((sheet) => readFile(path.join(ROOT, sheet), 'utf8')))).join('\n');
      bundles.set(key, { file: `assets/css/site.${sha(css)}.css`, css });
    }
    sheetLinks.first().before(`<link rel="stylesheet" href="${prefix}${bundles.get(key).file}">`);
    sheetLinks.remove();
  }

  moduleScripts.each((_, el) => {
    const src = urls.local($(el).attr('src'));
    const module = src?.startsWith('assets/js/') ? modules.get(src.slice('assets/js/'.length)) : null;
    if (!module) throw new Error(`page references unknown module ${$(el).attr('src')}`);
    $(el).attr('src', `${prefix}assets/js/${module.file}`);
  });
}

function formatDay(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function tocHtml(headings) {
  let html = '<ol class="toc__list">';
  let open = false; // an <ol> of h3s is open inside the last h2's <li>
  let started = false;
  for (const heading of headings) {
    const link = `<a class="toc__link" href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`;
    if (heading.level === 3 && started) {
      if (!open) html += '<ol class="toc__list toc__list--sub">';
      open = true;
      html += `<li class="toc__item toc__item--sub">${link}</li>`;
      continue;
    }
    if (open) html += '</ol>';
    if (started) html += '</li>';
    open = false;
    started = true;
    html += `<li class="toc__item">${link}`;
  }
  if (open) html += '</ol>';
  if (started) html += '</li>';
  return `${html}</ol>`;
}

function noteMetaHtml(note) {
  const stats = [
    `${note.minutes} min read`,
    `Updated <time datetime="${escapeHtml(note.modified)}">${escapeHtml(formatDay(note.modified))}</time>`,
    `${note.words.toLocaleString('en-US')} words`,
    `${note.sections} sections`,
  ]
    .map((item) => `<span>${item}</span>`)
    .join('');
  const tags = note.tags.map((tag) => `<li class="tag">${escapeHtml(tag)}</li>`).join('');
  return `<p class="eyebrow">${escapeHtml(note.kicker || 'Handbook')}</p>
<div class="reader-meta__row"><span class="badge badge--accent">${escapeHtml(note.category)}</span></div>
<h1 class="reader-meta__title">${escapeHtml(note.title)}</h1>
<p class="lede reader-meta__lede">${escapeHtml(note.description)}</p>
<p class="card__meta reader-meta__stats">${stats}</p>
${tags ? `<ul class="tag-list">${tags}</ul>` : ''}`;
}

function prevNextHtml(notes, index) {
  const link = (target, kind, label) =>
    target
      ? `<a class="reader-nav__item reader-nav__item--${kind}" href="${escapeHtml(target.href)}">
  <span class="reader-nav__label">${label}</span>
  <span class="reader-nav__title">${escapeHtml(target.title)}</span>
</a>`
      : '<span class="reader-nav__item is-empty" aria-hidden="true"></span>';
  return link(notes[index - 1], 'prev', 'Previous note') + link(notes[index + 1], 'next', 'Next note');
}

function setSocialMeta($, { title, description, url, type }) {
  $('title').text(title);
  $('meta[name="description"]').attr('content', description);
  $('link[rel="canonical"]').attr('href', url);
  $('meta[property="og:type"]').attr('content', type);
  $('meta[property="og:title"]').attr('content', title);
  $('meta[property="og:description"]').attr('content', description);
  $('meta[property="og:url"]').attr('content', url);
}

async function renderNotePage(template, content, index, context) {
  const { notes, config } = content;
  const note = notes[index];
  const $ = cheerio.load(template);
  const url = `${config.site.url}${note.href}`;
  const title = `${note.title} — ${config.site.name}`;

  setSocialMeta($, { title, description: note.description, url, type: 'article' });
  $('meta[property="og:type"]').after(
    `\n<meta property="article:modified_time" content="${escapeHtml(note.modified)}">` +
      `\n<meta property="article:section" content="${escapeHtml(note.category)}">`
  );
  $('head').append(
    `${jsonLd({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: note.title,
      description: note.description,
      url,
      dateModified: note.modified,
      articleSection: note.category,
      keywords: note.tags.join(', '),
      wordCount: note.words,
      timeRequired: `PT${note.minutes}M`,
      inLanguage: 'en',
      author: { '@type': 'Organization', name: config.site.name, url: config.site.url },
      publisher: { '@type': 'Organization', name: config.site.name, url: config.site.url },
      isPartOf: { '@type': 'WebSite', name: config.site.name, url: config.site.url },
    })}\n`
  );

  $('[data-note-title]').text(note.title);
  $('[data-note-meta]').html(noteMetaHtml(note));
  $('[data-note-body]').removeAttr('aria-busy').html(note.bodyHtml);

  if (note.headings.length > 1) {
    const toc = tocHtml(note.headings);
    $('[data-toc-list], [data-toc-list-mobile]').html(toc);
    $('[data-reader]').addClass('has-toc');
  } else {
    $('.reader__aside').remove();
  }

  const pdf = $('[data-note-pdf]');
  if (note.pdf) {
    pdf.attr({ href: note.pdf, 'aria-label': `Download the PDF companion for ${note.title}` }).removeAttr('hidden');
  } else {
    pdf.remove();
  }

  $('[data-reader-nav]').html(prevNextHtml(notes, index)).removeAttr('hidden');

  await publishAssets($, { ...context, prefix: '../../' });
  addSecurityMeta($);
  return $.html();
}

function noscriptList(items, render) {
  return `<noscript><ul class="noscript-list">${items.map(render).join('')}</ul></noscript>`;
}

async function renderPage(page, content, context) {
  const $ = cheerio.load(await readFile(path.join(ROOT, page), 'utf8'));
  const { notes, resources, config } = content;

  if (page === 'index.html') {
    $('head').append(
      `${jsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: config.site.name,
        url: config.site.url,
        inLanguage: 'en',
        publisher: { '@type': 'Organization', name: config.site.name, url: config.site.url },
      })}\n`
    );
  }
  // Library pages render from the manifest; give crawlers and no-JS readers real links.
  if (page === 'notes.html') {
    $('[data-notes-grid]').after(
      noscriptList(notes, (note) => `<li><a href="${escapeHtml(note.href)}">${escapeHtml(note.title)}</a> — ${escapeHtml(note.description)}</li>`)
    );
  }
  if (page === 'resources.html') {
    $('[data-resources-list]').after(
      noscriptList(resources, (item) => `<li><a href="${escapeHtml(item.href)}" download>${escapeHtml(item.title)}</a> (${escapeHtml(formatSize(item.bytes))})</li>`)
    );
  }

  const prefix = page === '404.html' ? context.urls.basePath : '';
  await publishAssets($, { ...context, prefix });
  addSecurityMeta($);
  return $.html();
}

/** `note.html?note=<slug>` was the reader URL before prerendering; keep old links alive. */
function redirectPage(content) {
  const slugs = JSON.stringify(content.notes.map((note) => note.slug));
  const script = `(function () {
  var slugs = ${slugs};
  var params = new URLSearchParams(location.search);
  var slug = params.get('note') || params.get('slug') || '';
  location.replace(slugs.indexOf(slug) >= 0 ? 'notes/' + slug + '/' + location.hash : 'notes.html');
})();`;
  const $ = cheerio.load(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Moved — ${escapeHtml(content.config.site.name)}</title>
<link rel="canonical" href="${escapeHtml(content.config.site.url)}notes.html">
<script>${script}</script>
</head>
<body>
<p>Notes now live at their own addresses. <a href="notes.html">Browse all notes</a>.</p>
</body>
</html>`);
  addSecurityMeta($);
  return $.html();
}

function sitemap(content) {
  const { config, notes, site } = content;
  const entries = [
    ...['index.html', 'notes.html', 'resources.html', 'about.html'].map((page) => ({
      loc: `${config.site.url}${page}`,
      lastmod: site.lastUpdated,
    })),
    ...notes.map((note) => ({ loc: `${config.site.url}${note.href}`, lastmod: note.modified })),
  ];
  const urls = entries
    .map(({ loc, lastmod }) => `  <url><loc>${escapeHtml(loc)}</loc><lastmod>${lastmod.slice(0, 10)}</lastmod></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/* -------------------------------------------------------------- build ---- */

export async function buildSite() {
  const content = await buildContent(ROOT);
  const urls = createUrlTools(content.config.site.url);
  const modules = await hashModules();
  const bundles = new Map();
  const context = { urls, modules, bundles };

  // Build into a private staging dir and swap it in at the end, so a preview
  // server (or a second build) never sees a half-written _site/.
  const staging = path.join(ROOT, `.site-staging-${process.pid}`);
  const writeOut = async (relative, data) => {
    const target = path.join(staging, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  };

  try {
    await rm(staging, { recursive: true, force: true });
    for (const page of PAGES) await writeOut(page, await renderPage(page, content, context));

    const template = await readFile(path.join(ROOT, NOTE_TEMPLATE), 'utf8');
    for (const [index, note] of content.notes.entries()) {
      await writeOut(`${note.href}index.html`, await renderNotePage(template, content, index, context));
    }
    await writeOut('note.html', redirectPage(content));

    for (const { file, code } of modules.values()) await writeOut(`assets/js/${file}`, code);
    for (const { file, css } of bundles.values()) await writeOut(file, css);
    for (const dir of COPY) await cp(path.join(ROOT, dir), path.join(staging, dir), { recursive: true });

    await writeOut('content/manifest.json', `${JSON.stringify(publicManifest(content), null, 2)}\n`);
    await writeOut('sitemap.xml', sitemap(content));
    await writeOut('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${content.config.site.url}sitemap.xml\n`);
    await writeOut('.nojekyll', '');

    await rm(OUT, { recursive: true, force: true });
    await rename(staging, OUT);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return content;
}

function report(content, { check }) {
  const { site, warnings } = content;
  console.log('InsightsMastery Academy — build');
  console.log(`  notes       ${site.noteCount}  (${site.totalWords.toLocaleString('en-US')} words · ${site.totalMinutes} min reading)`);
  console.log(`  resources   ${site.resourceCount}  (${formatSize(site.totalBytes)} on disk)`);
  console.log(`  categories  ${site.categories.join(', ') || '—'}`);
  console.log(`  tags        ${site.tags.length} unique · updated ${site.lastUpdated || '—'}`);
  // Warnings never fail the build: an uploaded file must always publish. In GitHub
  // Actions they become annotations on the run summary instead.
  for (const warning of warnings) {
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${warning}` : `  ! ${warning}`);
  }
  for (const note of warnings.soft) console.log(`  · ${note}`);
  console.log(check ? '  --check: nothing written' : `  → ${OUT_DIR}/`);
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const content = check ? await buildContent(ROOT) : await buildSite();
  if (!args.includes('--quiet')) report(content, { check });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`build: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
