/**
 * One handbook: metadata + a sanitised, prerendered article body.
 *
 * Source handbooks are standalone documents with their own chrome (cover,
 * sticky header, footer, inline CSS). Everything except the article body is
 * dropped, then the body passes an allowlist sanitiser — only the tags and
 * attributes below survive, and URLs are limited to http(s)/mailto (plus data:
 * images). The result is written straight into `notes/<slug>/index.html`.
 */

import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';

import { clamp, countWords, slugify } from './text.mjs';

const WORDS_PER_MINUTE = 210;
/** Code blocks are skimmed, not read: weight `<pre>` text at 40%. */
const CODE_WEIGHT = 0.4;

/** Source chrome that never belongs in the reader body. */
const STRIP = [
  'style', 'script', 'link', 'noscript', 'iframe', 'object', 'embed',
  'nav.toc', 'header', 'footer', '.cover', '.confidential', 'h1',
].join(', ');

const SANITIZE = {
  allowedTags: [
    'section', 'article', 'aside', 'div', 'span', 'p', 'br', 'hr',
    'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
    'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup', 'abbr', 'cite', 'q',
    'a', 'img', 'figure', 'figcaption',
    'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
    'details', 'summary',
  ],
  allowedAttributes: {
    '*': ['id', 'class', 'title', 'lang', 'dir', 'aria-label', 'aria-hidden'],
    a: ['href'],
    img: ['src', 'alt', 'width', 'height'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    col: ['span'],
    colgroup: ['span'],
    ol: ['start', 'reversed', 'type'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

/** The element that holds the article: `<main>`, then `.page`, then `<body>`. */
function articleRoot($) {
  for (const selector of ['main', '.page', 'body']) {
    const node = $(selector).first();
    if (node.length) return node;
  }
  return $.root();
}

function descriptionFrom($, bodyText) {
  const meta = $('meta[name="description"]').attr('content')?.trim();
  if (meta) return meta;
  const cover = $('header.cover p')
    .filter((_, el) => !/\b(kicker|sub|foot|lead)\b/i.test($(el).attr('class') ?? ''))
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .find((text) => text.length >= 24);
  if (cover) return cover;
  const lead = $('p.lead').first().text().replace(/\s+/g, ' ').trim();
  return lead || bodyText;
}

/** Sanitise the article, give every h2/h3 a unique id and collect the outline. */
function renderBody(rootHtml) {
  const clean = sanitizeHtml(rootHtml, SANITIZE);
  const $ = cheerio.load(clean, null, false);

  const used = new Set();
  $('[id]').each((_, el) => {
    if (!/^h[23]$/i.test(el.tagName)) used.add($(el).attr('id'));
  });
  const headings = [];
  $('h2, h3').each((_, el) => {
    const node = $(el);
    const text = node.text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const base = node.attr('id')?.trim() || slugify(text) || 'section';
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    node.attr('id', id);
    headings.push({ id, text, level: Number(el.tagName[1]) });
  });

  // Uploaded handbooks are standalone files: links to sibling files or to anchors that
  // lived in the stripped chrome cannot resolve on the site, so keep their text only.
  const ids = new Set($('[id]').map((_, el) => $(el).attr('id')).get());
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href').trim();
    if (/^(?:https?:|mailto:)/i.test(href)) return;
    if (href.startsWith('#') && ids.has(decodeURIComponent(href.slice(1)))) return;
    $(el).removeAttr('href');
  });
  $('img').each((_, el) => {
    if (!/^(?:https:|data:image\/)/i.test($(el).attr('src') ?? '')) $(el).remove();
  });

  $('a[href^="http"]').attr({ target: '_blank', rel: 'noopener noreferrer' });
  $('img').attr({ loading: 'lazy', decoding: 'async' });

  return { $, headings };
}

/** Everything the site needs from one handbook file. */
export function parseNote(html) {
  const $ = cheerio.load(html);
  const rawTitle = $('title')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .replace(/\s*[\u2013\u2014|-]\s*InsightsMastery(\s+Academy)?\s*$/i, '')
    .trim();
  const title = rawTitle || $('h1').first().text().replace(/\s+/g, ' ').trim() || 'Untitled note';
  const kicker = ($('header.cover p.kicker').first().text() || $('p.kicker').first().text())
    .replace(/\s+/g, ' ')
    .trim();

  const root = articleRoot($);
  const sectionTags = root.find('section[id]').length;
  root.find(STRIP).remove();
  const { $: body, headings } = renderBody(root.html() ?? '');

  const codeText = body('pre').text();
  const prose = cheerio.load(body.html(), null, false);
  prose('pre').remove();
  const proseText = prose.root().text();
  const words = countWords(proseText) + Math.round(CODE_WEIGHT * countWords(codeText));
  const firstParagraph = body('p').first().text().replace(/\s+/g, ' ').trim();

  return {
    title,
    kicker,
    description: clamp(descriptionFrom($, firstParagraph) || `Handbook covering ${title}.`),
    headings,
    // Handbooks without `<section id>` wrappers are still divided by their `<h2>`s.
    sections: sectionTags || headings.filter((heading) => heading.level === 2).length,
    words,
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    bodyHtml: body.html(),
  };
}
