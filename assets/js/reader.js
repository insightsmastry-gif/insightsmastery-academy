/**
 * Reader — renders one handbook from `notes/*.html` inside the site chrome.
 *
 * The source files are standalone documents with their own light-only CSS, so
 * everything except the article body is stripped before injection (see
 * `sanitiseNote`). All metadata (title, category, reading time, tags, PDF,
 * prev/next) comes from the manifest — the source HTML is never scraped twice.
 */

import {
  ContentError,
  escapeHtml,
  formatDate,
  loadManifest,
  readingLabel,
  resolveAssetUrl,
  slugify,
} from './content.js';
import { copyText, toast } from './ui.js';

const SIZE_KEY = 'im-reader-size';
const FOCUS_KEY = 'im-reader-focus';
const SIZES = ['s', 'm', 'l'];
const STRIP = ['style', 'script', 'link', 'noscript', 'iframe', 'object', 'embed',
  'nav.toc', 'header.cover', 'footer', '.confidential'];

const dom = {
  reader: document.querySelector('[data-reader]'),
  article: document.querySelector('[data-article]'),
  body: document.querySelector('[data-note-body]'),
  meta: document.querySelector('[data-note-meta]'),
  barTitle: document.querySelector('[data-note-title]'),
  progress: document.querySelector('[data-reading-progress]'),
  toc: document.querySelector('[data-toc-list]'),
  tocMobileList: document.querySelector('[data-toc-list-mobile]'),
  tocMobile: document.querySelector('[data-toc-mobile]'),
  nav: document.querySelector('[data-reader-nav]'),
  pdf: document.querySelector('[data-note-pdf]'),
  share: document.querySelector('[data-share]'),
};

let note = null;

// --- storage-backed preferences ---------------------------------------------

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked — preference stays for this page only */
  }
}

function applySize(size) {
  const value = SIZES.includes(size) ? size : 'm';
  dom.reader?.setAttribute('data-size', value);
  document.querySelectorAll('[data-font-size]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.fontSize === value));
  });
  return value;
}

function applyFocus(on) {
  dom.reader?.classList.toggle('is-focus', on);
  document.querySelectorAll('[data-focus-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(on));
  });
}

function initPreferences() {
  applySize(readStored(SIZE_KEY, 'm'));
  applyFocus(readStored(FOCUS_KEY, 'false') === 'true');

  document.querySelectorAll('[data-font-size]').forEach((button) => {
    button.addEventListener('click', () => {
      writeStored(SIZE_KEY, applySize(button.dataset.fontSize));
    });
  });

  document.querySelectorAll('[data-focus-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      applyFocus(on);
      writeStored(FOCUS_KEY, String(on));
    });
  });
}

// --- share -------------------------------------------------------------------

function initShare() {
  dom.share?.addEventListener('click', async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, text: note?.description ?? '', url });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    const ok = await copyText(url);
    toast(ok ? 'Link copied to clipboard' : 'Copy failed — copy the address bar manually', {
      tone: ok ? 'success' : 'error',
    });
  });
}

// --- sanitising the source handbook -----------------------------------------

function absolutise(value) {
  if (!value) return value;
  if (/^(https?:|mailto:|tel:|data:|#)/i.test(value)) return value;
  if (value.startsWith('//') || value.startsWith('/')) return value;
  return `notes/${value.replace(/^\.\//, '')}`;
}

function rewriteUrls(root) {
  root.querySelectorAll('[href]').forEach((el) => {
    const raw = el.getAttribute('href');
    if (/^\s*javascript:/i.test(raw ?? '')) {
      el.removeAttribute('href');
      return;
    }
    if (/^(https?:)?\/\//i.test(raw ?? '') || /^mailto:/i.test(raw ?? '')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
      return;
    }
    el.setAttribute('href', absolutise(raw));
  });
  root.querySelectorAll('[src]').forEach((el) => {
    el.setAttribute('src', absolutise(el.getAttribute('src')));
    if (el.tagName === 'IMG') el.setAttribute('loading', 'lazy');
  });
}

/**
 * Turn a standalone handbook document into a safe fragment for `.prose`.
 * Drops the source's own styling/chrome and any executable attribute.
 */
function sanitiseNote(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  STRIP.forEach((selector) => doc.querySelectorAll(selector).forEach((el) => el.remove()));
  const root = doc.querySelector('main') ?? doc.querySelector('.page') ?? doc.body;
  root.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach(({ name }) => {
      if (name.toLowerCase().startsWith('on') || name.toLowerCase() === 'style') {
        el.removeAttribute(name);
      }
    });
  });
  rewriteUrls(root);
  const fragment = document.createDocumentFragment();
  fragment.append(...root.childNodes);
  return fragment;
}

async function fetchNote(file) {
  let response;
  const targetUrl = resolveAssetUrl(file);
  try {
    response = await fetch(targetUrl, { cache: 'no-cache' });
  } catch (error) {
    throw new ContentError('Could not download this note.', {
      cause: error,
      hint: `Expected ${file} to be reachable. Serve the site over http (npm start).`,
    });
  }
  if (!response.ok) {
    throw new ContentError(`This note returned HTTP ${response.status}.`, {
      hint: `${file} is listed in the manifest but missing on disk — re-run npm run build.`,
    });
  }
  return response.text();
}

// --- table of contents + scrollspy ------------------------------------------

function collectHeadings() {
  const used = new Set();
  return [...dom.body.querySelectorAll('h2, h3')].map((heading) => {
    let id = heading.id || slugify(heading.textContent);
    if (!id) id = 'section';
    let unique = id;
    let n = 2;
    while (used.has(unique)) unique = `${id}-${n++}`;
    used.add(unique);
    heading.id = unique;
    return heading;
  });
}

function buildTocList(headings) {
  const list = document.createElement('ol');
  list.className = 'toc__list';
  let sub = null;
  headings.forEach((heading) => {
    const item = document.createElement('li');
    item.className = 'toc__item';
    const link = document.createElement('a');
    link.className = 'toc__link';
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent.trim();
    item.append(link);
    if (heading.tagName === 'H3' && list.lastElementChild) {
      if (!sub) {
        sub = document.createElement('ol');
        sub.className = 'toc__list toc__list--sub';
        list.lastElementChild.append(sub);
      }
      item.classList.add('toc__item--sub');
      sub.append(item);
    } else {
      sub = null;
      list.append(item);
    }
  });
  return list;
}

function renderToc(headings) {
  const hasToc = headings.length > 1;
  dom.reader?.classList.toggle('has-toc', hasToc);
  if (!hasToc) {
    dom.toc?.replaceChildren();
    dom.tocMobileList?.replaceChildren();
    return;
  }
  const list = buildTocList(headings);
  dom.toc?.replaceChildren(list);
  dom.tocMobileList?.replaceChildren(list.cloneNode(true));
  dom.tocMobile?.addEventListener('click', (event) => {
    if (event.target.closest('.toc__link')) dom.tocMobile.open = false;
  });
}

function initScrollspy(headings) {
  if (!headings.length || !('IntersectionObserver' in window)) return;
  const setActive = (id) => {
    document.querySelectorAll('.toc__link').forEach((link) => {
      const on = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('is-active', on);
      if (on) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  };
  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });
      const current = headings.find((heading) => visible.has(heading.id));
      if (current) setActive(current.id);
    },
    { rootMargin: '-22% 0px -68% 0px', threshold: 0 }
  );
  headings.forEach((heading) => observer.observe(heading));
  setActive(headings[0].id);
}

// --- reading progress --------------------------------------------------------

function initProgress() {
  if (!dom.progress || !dom.article) return;
  let queued = false;
  const update = () => {
    queued = false;
    const rect = dom.article.getBoundingClientRect();
    if (rect.height <= 0) return;
    const seen = window.innerHeight - rect.top;
    const ratio = Math.min(1, Math.max(0, seen / rect.height));
    dom.progress.style.setProperty('--progress', ratio.toFixed(4));
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

// --- metadata ----------------------------------------------------------------

function setHead(title, description) {
  document.title = `${title} — InsightsMastery Academy`;
  const url = `https://insightsmastry-gif.github.io/insightsmastery-academy/note.html${window.location.search}`;
  const set = (selector, attribute, value) => {
    const node = document.querySelector(selector);
    if (node) node.setAttribute(attribute, value);
  };
  set('link[rel="canonical"]', 'href', url);
  set('meta[property="og:url"]', 'content', url);
  set('meta[property="og:title"]', 'content', document.title);
  if (description) {
    set('meta[name="description"]', 'content', description);
    set('meta[property="og:description"]', 'content', description);
  }
}

function renderMeta(current) {
  if (dom.barTitle) dom.barTitle.textContent = current.title;
  const stats = [
    readingLabel(current.minutes),
    `Updated ${formatDate(current.modified)}`,
    `${Number(current.words || 0).toLocaleString()} words`,
    `${current.sections || 0} sections`,
  ]
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join('');
  const tags = (current.tags ?? [])
    .map((tag) => `<li class="tag">${escapeHtml(tag)}</li>`)
    .join('');
  dom.meta.innerHTML = `<p class="eyebrow">${escapeHtml(current.kicker || 'Handbook')}</p>
<div class="reader-meta__row">
  <span class="badge badge--accent">${escapeHtml(current.category ?? 'Handbook')}</span>
</div>
<h1 class="reader-meta__title">${escapeHtml(current.title)}</h1>
<p class="lede reader-meta__lede">${escapeHtml(current.description ?? '')}</p>
<p class="card__meta reader-meta__stats">${stats}</p>
${tags ? `<ul class="tag-list">${tags}</ul>` : ''}`;

  if (dom.pdf && current.pdf) {
    dom.pdf.href = current.pdf;
    dom.pdf.hidden = false;
    dom.pdf.setAttribute('aria-label', `Download the PDF companion for ${current.title}`);
  }
}

function renderPrevNext(current, notes) {
  if (!dom.nav) return;
  const index = notes.findIndex((item) => item.slug === current.slug);
  const link = (target, kind, label) =>
    target
      ? `<a class="reader-nav__item reader-nav__item--${kind}" href="${escapeHtml(target.href)}">
  <span class="reader-nav__label">${label}</span>
  <span class="reader-nav__title">${escapeHtml(target.title)}</span>
</a>`
      : '<span class="reader-nav__item is-empty" aria-hidden="true"></span>';
  dom.nav.innerHTML =
    link(notes[index - 1], 'prev', 'Previous note') + link(notes[index + 1], 'next', 'Next note');
  dom.nav.hidden = false;
}

// --- failure states ----------------------------------------------------------

function showNotFound(slug) {
  document.title = 'Note not found — InsightsMastery Academy';
  if (dom.barTitle) dom.barTitle.textContent = 'Note not found';
  dom.reader?.classList.remove('has-toc');
  dom.meta?.replaceChildren();
  dom.body.setAttribute('aria-busy', 'false');
  dom.body.innerHTML = `<div class="empty">
  <span class="empty__icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5m0 3h.01"/><circle cx="12" cy="12" r="8.5"/></svg>
  </span>
  <h1 class="empty__title">We couldn&rsquo;t find that note</h1>
  <p class="empty__text">${
    slug ? `No handbook is published under <code>${escapeHtml(slug)}</code>.` : 'No note was requested.'
  } It may have been renamed.</p>
  <div class="cluster">
    <a class="btn btn--primary btn--sm" href="notes.html">Browse all notes</a>
    <a class="btn btn--outline btn--sm" href="resources.html">PDF downloads</a>
  </div>
</div>`;
}

function showError(error) {
  const hint = error instanceof ContentError && error.hint ? error.hint : '';
  if (dom.barTitle) dom.barTitle.textContent = 'Something went wrong';
  dom.meta?.replaceChildren();
  dom.body.setAttribute('aria-busy', 'false');
  dom.body.innerHTML = `<div class="alert alert--error" role="alert">
  <p class="alert__title">This note could not be displayed</p>
  <p class="alert__text">${escapeHtml(error.message)}${
    hint ? ` <code>${escapeHtml(hint)}</code>` : ''
  }</p>
</div>
<p><a class="btn btn--outline btn--sm" href="notes.html">Back to the notes library</a></p>`;
  console.error(error);
}

// --- boot --------------------------------------------------------------------

function jumpToHash() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
}

async function boot() {
  if (!dom.reader || !dom.body) return;
  initPreferences();
  initShare();

  const params = new URLSearchParams(window.location.search);
  const slug = (params.get('note') || params.get('slug') || '').trim();

  let manifest;
  try {
    manifest = await loadManifest();
  } catch (error) {
    showError(error);
    return;
  }

  const notes = manifest.notes ?? [];
  note = notes.find((item) => item.slug === slug) ?? null;
  if (!note) {
    showNotFound(slug);
    return;
  }

  setHead(note.title, note.description);
  renderMeta(note);
  renderPrevNext(note, notes);

  let html;
  try {
    html = await fetchNote(note.file);
  } catch (error) {
    showError(error);
    return;
  }

  dom.body.replaceChildren(sanitiseNote(html));
  dom.body.setAttribute('aria-busy', 'false');

  const headings = collectHeadings();
  renderToc(headings);
  initScrollspy(headings);
  initProgress();
  jumpToHash();
}

boot();
