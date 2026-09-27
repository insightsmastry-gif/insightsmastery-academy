/**
 * Reader enhancements for a prerendered note page (`notes/<slug>/`).
 *
 * The build writes the article, metadata, table of contents and prev/next
 * links into the HTML, so the page is complete without JavaScript. This module
 * only adds behaviour: text size, focus mode, share, ToC scrollspy and the
 * reading-progress bar.
 */

import { copyText, toast } from './ui.js';

const SIZE_KEY = 'im-reader-size';
const FOCUS_KEY = 'im-reader-focus';
const SIZES = ['s', 'm', 'l'];

const dom = {
  reader: document.querySelector('[data-reader]'),
  article: document.querySelector('[data-article]'),
  body: document.querySelector('[data-note-body]'),
  progress: document.querySelector('[data-reading-progress]'),
  tocMobile: document.querySelector('[data-toc-mobile]'),
  share: document.querySelector('[data-share]'),
};

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
    const url = document.querySelector('link[rel="canonical"]')?.href ?? window.location.href;
    const text = document.querySelector('meta[name="description"]')?.content ?? '';
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, text, url });
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

// --- table of contents -------------------------------------------------------

function initScrollspy() {
  const links = [...document.querySelectorAll('.toc__link')];
  const headings = [...new Set(links.map((link) => link.getAttribute('href').slice(1)))]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!headings.length || !('IntersectionObserver' in window)) return;

  const setActive = (id) => {
    links.forEach((link) => {
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

  dom.tocMobile?.addEventListener('click', (event) => {
    if (event.target.closest('.toc__link')) dom.tocMobile.open = false;
  });
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

if (dom.reader && dom.body) {
  initPreferences();
  initShare();
  initScrollspy();
  initProgress();
}
