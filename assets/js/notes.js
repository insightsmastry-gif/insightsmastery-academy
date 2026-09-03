/**
 * Notes library — search, single-select category chips, four sort modes and
 * shareable `?q=&category=&sort=` state.
 *
 * Every note comes from `content/manifest.json`; nothing here knows the name
 * of a single handbook. Manifest strings only reach innerHTML through
 * escapeHtml()/highlight().
 */

import {
  ContentError,
  debounce,
  escapeHtml,
  formatRelative,
  highlight,
  loadManifest,
  matchesQuery,
  readingLabel,
} from './content.js';
import { observeReveals } from './ui.js';

const SORTS = {
  recent: (a, b) => Date.parse(b.modified || 0) - Date.parse(a.modified || 0),
  title: (a, b) => String(a.title).localeCompare(String(b.title)),
  longest: (a, b) => (b.minutes || 0) - (a.minutes || 0),
  shortest: (a, b) => (a.minutes || 0) - (b.minutes || 0),
};
const DEFAULT_SORT = 'recent';

const dom = {
  grid: document.querySelector('[data-notes-grid]'),
  summary: document.querySelector('[data-notes-count]'),
  search: document.querySelector('[data-search-input]'),
  searchWrap: document.querySelector('.search'),
  clear: document.querySelector('[data-search-clear]'),
  chips: document.querySelector('[data-category-filter]'),
  sort: document.querySelector('[data-sort-select]'),
};

const state = { query: '', category: '', sort: DEFAULT_SORT };
let notes = [];
let site = null;

// --- URL state ---------------------------------------------------------------

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  state.query = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  state.category = category;
  const sort = params.get('sort') ?? '';
  state.sort = Object.hasOwn(SORTS, sort) ? sort : DEFAULT_SORT;
}

function writeUrlState() {
  const params = new URLSearchParams();
  if (state.query.trim()) params.set('q', state.query.trim());
  if (state.category) params.set('category', state.category);
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  const search = params.toString();
  history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
}

// --- filtering ---------------------------------------------------------------

function visibleNotes() {
  const compare = SORTS[state.sort] ?? SORTS[DEFAULT_SORT];
  return notes
    .filter((note) => !state.category || note.category === state.category)
    .filter((note) =>
      matchesQuery(state.query, [
        note.title,
        note.description,
        note.kicker,
        note.category,
        ...(note.tags ?? []),
        ...(note.headings ?? []).map((heading) => heading.text),
      ])
    )
    .sort(compare);
}

// --- rendering ---------------------------------------------------------------

function cardHtml(note) {
  const query = state.query.trim();
  const title = highlight(escapeHtml(note.title), query);
  const description = highlight(escapeHtml(note.description ?? ''), query);
  const tags = (note.tags ?? [])
    .map((tag) => `<li class="tag">${highlight(escapeHtml(tag), query)}</li>`)
    .join('');
  const meta = [
    readingLabel(note.minutes),
    `Updated ${formatRelative(note.modified)}`,
    `${Number(note.words || 0).toLocaleString()} words`,
  ]
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join('');
  const pdf = note.pdf
    ? `<a class="badge badge--muted note-card__pdf" href="${escapeHtml(note.pdf)}" download
          aria-label="Download the PDF companion for ${escapeHtml(note.title)}">PDF</a>`
    : '';

  return `<article class="card card--interactive note-card" data-reveal>
  <div class="note-card__head">
    <span class="badge badge--accent">${escapeHtml(note.category ?? 'Handbook')}</span>
    <span class="note-card__sections">${escapeHtml(String(note.sections || 0))} sections</span>
  </div>
  <h2 class="card__title">${title}</h2>
  <p class="card__text">${description}</p>
  ${tags ? `<ul class="tag-list">${tags}</ul>` : ''}
  <p class="card__meta">${meta}</p>
  <div class="card__footer">
    <a class="card__link" href="${escapeHtml(note.href || `note.html?note=${note.slug}`)}"
       aria-label="Read ${escapeHtml(note.title)}">Read the handbook</a>
    ${pdf}
  </div>
</article>`;
}

function emptyHtml() {
  const term = state.query.trim();
  const detail = term
    ? `Nothing matches &ldquo;${highlight(escapeHtml(term), term)}&rdquo;${
        state.category ? ` in ${escapeHtml(state.category)}` : ''
      }.`
    : `There are no notes in ${escapeHtml(state.category)} yet.`;
  return `<div class="empty">
  <span class="empty__icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
  </span>
  <h2 class="empty__title">No notes match your filters</h2>
  <p class="empty__text">${detail} Try a broader term, or reset everything.</p>
  <div class="cluster">
    <button class="btn btn--primary btn--sm" type="button" data-clear-filters>Clear filters</button>
    <a class="btn btn--outline btn--sm" href="resources.html">Browse PDFs instead</a>
  </div>
</div>`;
}

function errorHtml(error) {
  const hint = error instanceof ContentError && error.hint ? error.hint : '';
  return `<div class="alert alert--error" role="alert">
  <p class="alert__title">The notes library could not load</p>
  <p class="alert__text">${escapeHtml(error.message)}${hint ? ` <code>${escapeHtml(hint)}</code>` : ''}</p>
</div>`;
}

function renderSummary(shown) {
  if (!dom.summary || !site) return;
  const total = site.noteCount ?? notes.length;
  const filtered = shown.length !== total;
  const minutes = shown.reduce((sum, note) => sum + (note.minutes || 0), 0);
  dom.summary.textContent = filtered
    ? `Showing ${shown.length} of ${total} notes · ${minutes} min of reading`
    : `${total} notes · ${site.totalMinutes ?? minutes} min of reading`;
}

function render() {
  if (!dom.grid) return;
  const shown = visibleNotes();
  dom.grid.classList.toggle('is-single', shown.length === 0);
  dom.grid.innerHTML = shown.length ? shown.map(cardHtml).join('') : emptyHtml();
  dom.grid.setAttribute('aria-busy', 'false');
  renderSummary(shown);
  observeReveals(dom.grid);
}

function renderChips() {
  if (!dom.chips) return;
  const counts = new Map();
  notes.forEach((note) => counts.set(note.category, (counts.get(note.category) ?? 0) + 1));
  const categories = site?.categories?.length ? site.categories : [...counts.keys()].sort();
  const entries = [{ value: '', label: 'All', count: notes.length }].concat(
    categories.map((category) => ({
      value: category,
      label: category,
      count: counts.get(category) ?? 0,
    }))
  );
  dom.chips.innerHTML = entries
    .map(
      (entry) => `<button class="chip" type="button" data-category="${escapeHtml(entry.value)}"
  aria-pressed="${entry.value === state.category}">${escapeHtml(entry.label)}<span class="chip__count">${entry.count}</span></button>`
    )
    .join('');
}

function syncControls() {
  if (dom.search) dom.search.value = state.query;
  if (dom.sort) dom.sort.value = state.sort;
  const hasValue = Boolean(state.query);
  dom.searchWrap?.classList.toggle('has-value', hasValue);
  if (dom.clear) dom.clear.hidden = !hasValue;
  dom.chips?.querySelectorAll('[data-category]').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(chip.dataset.category === state.category));
  });
}

// --- events ------------------------------------------------------------------

function commit() {
  syncControls();
  writeUrlState();
  render();
}

function bindEvents() {
  const onInput = debounce(() => {
    state.query = dom.search?.value ?? '';
    commit();
  }, 140);

  dom.search?.addEventListener('input', () => {
    const hasValue = Boolean(dom.search.value);
    dom.searchWrap?.classList.toggle('has-value', hasValue);
    if (dom.clear) dom.clear.hidden = !hasValue;
    onInput();
  });

  dom.search?.addEventListener('search', () => {
    state.query = dom.search.value;
    commit();
  });

  dom.clear?.addEventListener('click', () => {
    state.query = '';
    commit();
    dom.search?.focus();
  });

  dom.chips?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category]');
    if (!chip) return;
    state.category = chip.dataset.category;
    commit();
  });

  dom.sort?.addEventListener('change', () => {
    state.sort = Object.hasOwn(SORTS, dom.sort.value) ? dom.sort.value : DEFAULT_SORT;
    commit();
  });

  dom.grid?.addEventListener('click', (event) => {
    if (!event.target.closest('[data-clear-filters]')) return;
    state.query = '';
    state.category = '';
    state.sort = DEFAULT_SORT;
    commit();
    dom.search?.focus();
  });

  window.addEventListener('popstate', () => {
    readUrlState();
    syncControls();
    render();
  });
}

// --- boot --------------------------------------------------------------------

async function boot() {
  if (!dom.grid) return;
  readUrlState();
  syncControls();
  try {
    const manifest = await loadManifest();
    notes = manifest.notes ?? [];
    site = manifest.site ?? {};
    if (state.category && !notes.some((note) => note.category === state.category)) {
      state.category = '';
    }
    renderChips();
    bindEvents();
    commit();
  } catch (error) {
    dom.grid.classList.add('is-single');
    dom.grid.innerHTML = errorHtml(error);
    dom.grid.setAttribute('aria-busy', 'false');
    if (dom.summary) dom.summary.textContent = 'Library unavailable';
    console.error(error);
  }
}

boot();
