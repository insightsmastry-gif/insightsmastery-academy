/**
 * Marketing pages module — home, about and 404 share this file.
 *
 * Everything it renders comes from `content/manifest.json`; nothing about the
 * library is hard-coded. Every DOM lookup is guarded so the same module can be
 * loaded on a page that has none of the hooks.
 */

import {
  ContentError,
  escapeHtml,
  formatRelative,
  loadManifest,
  readingLabel,
} from './content.js';
import { observeCounters, observeReveals, toast } from './ui.js';

const FEEDBACK_TO = 'hello@insightsmastry.in';
const LATEST_COUNT = 3;

// --- hero stats --------------------------------------------------------------

/** Map a `[data-stat]` key onto a `manifest.site` field. */
const STAT_FIELDS = {
  notes: 'noteCount',
  resources: 'resourceCount',
  minutes: 'totalMinutes',
  words: 'totalWords',
};

function fillStats(site) {
  const nodes = document.querySelectorAll('[data-stat]');
  if (!nodes.length || !site) return;
  nodes.forEach((node) => {
    const field = STAT_FIELDS[node.dataset.stat];
    const value = field ? site[field] : undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    node.dataset.countTo = String(Math.round(value));
    node.classList.remove('is-counted'); // allow a re-run if ui.js already swept the page
    node.textContent = '0';
  });
  observeCounters(document);
}

// --- latest notes ------------------------------------------------------------

function noteCard(note) {
  const href = `note.html?note=${encodeURIComponent(note.slug)}`;
  const meta = [readingLabel(note.minutes), formatRelative(note.modified)]
    .filter(Boolean)
    .map((bit) => `<span>${escapeHtml(bit)}</span>`)
    .join('');
  return `
    <article class="card card--interactive" data-reveal>
      <p class="eyebrow">${escapeHtml(note.category || note.kicker || 'Handbook')}</p>
      <h3 class="card__title"><a class="card__link" href="${href}">${escapeHtml(note.title)}</a></h3>
      <p class="card__text">${escapeHtml(note.description || '')}</p>
      <p class="card__meta">${meta}</p>
    </article>`;
}

function renderLatest(container, notes) {
  const latest = [...notes]
    .sort((a, b) => Date.parse(b.modified || 0) - Date.parse(a.modified || 0))
    .slice(0, LATEST_COUNT);

  if (!latest.length) {
    container.innerHTML =
      '<p class="muted">No notes published yet — drop an HTML file in <code>notes/</code> and rebuild.</p>';
    return;
  }
  container.innerHTML = latest.map(noteCard).join('');
  container.setAttribute('aria-busy', 'false');
  observeReveals(container);
}

function renderError(container, error) {
  const hint = error instanceof ContentError && error.hint ? error.hint : '';
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `
    <div class="alert alert--error" role="alert">
      <p class="alert__title">Couldn't load the notes index.</p>
      <p class="alert__text">${escapeHtml(error.message || 'Unknown error.')}${
        hint ? ` ${escapeHtml(hint)}` : ''
      }</p>
    </div>`;
}

// --- about counts ------------------------------------------------------------

function fillAbout(site) {
  if (!site) return;
  const pairs = [
    ['[data-about-notes]', site.noteCount],
    ['[data-about-resources]', site.resourceCount],
    ['[data-about-minutes]', site.totalMinutes],
    ['[data-about-categories]', Array.isArray(site.categories) ? site.categories.length : undefined],
  ];
  pairs.forEach(([selector, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    document.querySelectorAll(selector).forEach((node) => {
      node.textContent = String(value);
    });
  });

  const list = document.querySelector('[data-about-category-list]');
  if (list && Array.isArray(site.categories) && site.categories.length) {
    list.innerHTML = site.categories
      .map((name) => `<li class="about-tag">${escapeHtml(name)}</li>`)
      .join('');
  }
}

// --- feedback form -----------------------------------------------------------

function initFeedbackForm() {
  const form = document.querySelector('[data-feedback-form]');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const topic = String(data.get('topic') || 'General feedback').trim();
    const message = String(data.get('message') || '').trim();

    if (!message) {
      toast('Add a short message first.', { tone: 'error' });
      const field = form.querySelector('[name="message"]');
      if (field) field.focus();
      return;
    }

    const subject = `[InsightsMastery Academy] ${topic}`;
    const body = [
      message,
      '',
      '—',
      name ? `From: ${name}` : 'From: (anonymous)',
      `Page: ${window.location.href}`,
    ].join('\n');
    const href = `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;

    window.location.href = href;
    toast('Opening your mail app…', { tone: 'success' });
    form.reset();
  });
}

// --- boot --------------------------------------------------------------------

async function boot() {
  initFeedbackForm();

  const homeNotes = document.querySelector('[data-home-notes]');
  const needsManifest =
    homeNotes ||
    document.querySelector('[data-stat]') ||
    document.querySelector('[data-about-notes], [data-about-resources]');
  if (!needsManifest) return;

  try {
    const manifest = await loadManifest();
    fillStats(manifest.site);
    fillAbout(manifest.site);
    if (homeNotes) renderLatest(homeNotes, manifest.notes || []);
  } catch (error) {
    if (homeNotes) renderError(homeNotes, error);
    else if (error instanceof ContentError) console.warn(error.message, error.hint);
  }
}

boot();
