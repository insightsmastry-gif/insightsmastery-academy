/**
 * resources.html — PDF download browser.
 *
 * Pure render-from-state: every keystroke, chip or sort change mutates `state`,
 * syncs the URL and calls `render()`, which rebuilds the whole list from the
 * manifest. Nothing here knows a filename — `content/manifest.json` is the only
 * source of truth, so dropping a new PDF in `pdfs/` publishes it on the next
 * deploy with zero code change.
 */

import {
  ContentError,
  debounce,
  escapeHtml,
  formatBytes,
  formatRelative,
  getResources,
  highlight,
  matchesQuery,
} from './content.js';
import { observeReveals, toast } from './ui.js';

const SORTS = ['name', 'newest', 'largest'];
const ALL = '';

const state = { q: '', category: ALL, sort: 'name' };

const dom = {
  list: document.querySelector('[data-resources-list]'),
  summary: document.querySelector('[data-resources-summary]'),
  chips: document.querySelector('[data-category-filter]'),
  search: document.querySelector('[data-search]'),
  input: document.querySelector('[data-search-input]'),
  clear: document.querySelector('[data-search-clear]'),
  sort: document.querySelector('[data-sort-select]'),
};

const ICON_PDF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>' +
  '<path d="M8.5 17v-3.4h1.2a1.1 1.1 0 0 1 0 2.2H8.5M13.2 17v-3.4h.9a1.7 1.7 0 0 1 0 3.4zM17.5 13.6h1.6M17.5 15.3h1.2M17.5 17v-3.4"/></svg>';

const ICON_DOWNLOAD =
  '<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/></svg>';

let resources = [];

// --- state <-> URL -----------------------------------------------------------

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  state.q = params.get('q') ?? '';
  state.category = params.get('category') ?? ALL;
  const sort = params.get('sort');
  state.sort = SORTS.includes(sort) ? sort : 'name';
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.category) params.set('category', state.category);
  if (state.sort !== 'name') params.set('sort', state.sort);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

// --- derivation --------------------------------------------------------------

function categories() {
  return [...new Set(resources.map((item) => item.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

/** Manifest titles are already human, but strip any leftover prefix/underscores. */
function cleanTitle(title) {
  return String(title ?? 'Untitled')
    .replace(/_+/g, ' ')
    .replace(/^InsightsMastery\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function filtered() {
  const list = resources.filter((item) => {
    if (state.category && item.category !== state.category) return false;
    return matchesQuery(state.q, [
      item.title,
      item.description,
      item.category,
      ...(item.tags ?? []),
      item.file,
    ]);
  });
  const byTitle = (a, b) => cleanTitle(a.title).localeCompare(cleanTitle(b.title));
  if (state.sort === 'newest') {
    return list.sort(
      (a, b) => new Date(b.modified ?? 0) - new Date(a.modified ?? 0) || byTitle(a, b)
    );
  }
  if (state.sort === 'largest') {
    return list.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || byTitle(a, b));
  }
  return list.sort(byTitle);
}

// --- templates ---------------------------------------------------------------

function cardHtml(resource) {
  const q = state.q;
  const title = highlight(escapeHtml(cleanTitle(resource.title)), q);
  const description = highlight(escapeHtml(resource.description ?? ''), q);
  const href = escapeHtml(resource.file ?? resource.href ?? '');
  const size = escapeHtml(resource.size || formatBytes(resource.bytes));
  const ext = escapeHtml((resource.ext || 'pdf').toUpperCase());
  const tags = (resource.tags ?? [])
    .map((tag) => `<li class="tag">${highlight(escapeHtml(tag), q)}</li>`)
    .join('');
  const readOnline = resource.note
    ? `<a class="btn btn--ghost btn--sm" href="note.html?note=${encodeURIComponent(
        resource.note
      )}">Read online</a>`
    : '';

  return `<article class="card card--interactive resource-card" data-reveal>
  <span class="resource-card__icon" aria-hidden="true">${ICON_PDF}</span>
  <div class="resource-card__body">
    <h3 class="card__title">${title}</h3>
    ${description ? `<p class="card__text">${description}</p>` : ''}
    <p class="card__meta">
      <span class="resource-card__size">${size}</span>
      <span>Updated ${escapeHtml(formatRelative(resource.modified))}</span>
      <span class="badge badge--accent">${ext}</span>
    </p>
    ${tags ? `<ul class="tag-list">${tags}</ul>` : ''}
  </div>
  <div class="resource-card__actions">
    <a class="btn btn--primary btn--sm" href="${href}" download>${ICON_DOWNLOAD}<span>Download</span></a>
    <a class="btn btn--ghost btn--sm" href="${href}" target="_blank" rel="noopener">Preview</a>
    ${readOnline}
  </div>
</article>`;
}

function groupsHtml(list) {
  const buckets = new Map();
  list.forEach((item) => {
    const key = item.category || 'Other';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([category, items]) => `<section class="resource-group" data-reveal-group data-reveal-step="60">
  <div class="resource-group__head">
    <h2 class="h3">${escapeHtml(category)}</h2>
    <span class="badge badge--muted">${items.length} ${items.length === 1 ? 'file' : 'files'}</span>
  </div>
  <div class="resource-group__grid">${items.map(cardHtml).join('')}</div>
</section>`
    )
    .join('');
}

function emptyHtml() {
  return `<div class="empty" data-reveal>
  <span class="empty__icon" aria-hidden="true">${ICON_PDF}</span>
  <p class="empty__title">No downloads match those filters</p>
  <p class="empty__text">Try a different search term, or clear the filters to see every handbook and SOP.</p>
  <div class="cluster">
    <button class="btn btn--outline btn--sm" type="button" data-clear-filters>Clear filters</button>
  </div>
</div>`;
}

function errorHtml(error) {
  const hint = error instanceof ContentError ? error.hint : 'Reload the page and try again.';
  return `<div class="alert alert--error" role="alert">
  <p class="alert__title">Downloads are unavailable</p>
  <p class="alert__text">${escapeHtml(error.message)}</p>
  <p class="alert__text">${escapeHtml(hint)}</p>
</div>`;
}

// --- rendering ---------------------------------------------------------------

function renderSummary(list) {
  if (!dom.summary) return;
  const bytes = list.reduce((total, item) => total + (item.bytes ?? 0), 0);
  const noun = list.length === 1 ? 'file' : 'files';
  if (!list.length) {
    dom.summary.textContent = `No matches · ${resources.length} files in the library`;
  } else if (list.length === resources.length) {
    dom.summary.textContent = `${list.length} ${noun} · ${formatBytes(bytes)} total`;
  } else {
    dom.summary.textContent = `${list.length} of ${resources.length} files · ${formatBytes(bytes)}`;
  }
}

function renderChips() {
  if (!dom.chips) return;
  const options = [{ value: ALL, label: 'All' }].concat(
    categories().map((category) => ({ value: category, label: category }))
  );
  dom.chips.innerHTML = options
    .map(
      (option) =>
        `<button class="chip" type="button" data-category="${escapeHtml(option.value)}" aria-pressed="${
          state.category === option.value ? 'true' : 'false'
        }">${escapeHtml(option.label)}</button>`
    )
    .join('');
}

function renderControls() {
  if (dom.input && dom.input.value !== state.q) dom.input.value = state.q;
  if (dom.sort && dom.sort.value !== state.sort) dom.sort.value = state.sort;
  dom.search?.classList.toggle('has-value', Boolean(state.q));
  dom.chips?.querySelectorAll('[data-category]').forEach((chip) => {
    chip.setAttribute('aria-pressed', chip.dataset.category === state.category ? 'true' : 'false');
  });
}

function render() {
  if (!dom.list) return;
  const list = filtered();
  renderSummary(list);
  renderControls();
  dom.list.dataset.view = list.length ? state.sort : 'empty';
  dom.list.setAttribute('aria-busy', 'false');
  if (!list.length) {
    dom.list.innerHTML = emptyHtml();
  } else if (state.sort === 'name') {
    dom.list.innerHTML = groupsHtml(list);
  } else {
    dom.list.innerHTML = `<div class="resource-group__grid" data-reveal-group data-reveal-step="60">${list
      .map(cardHtml)
      .join('')}</div>`;
  }
  observeReveals(dom.list);
}

// --- events ------------------------------------------------------------------

function update(patch) {
  Object.assign(state, patch);
  writeUrl();
  render();
}

function bind() {
  const onInput = debounce((value) => update({ q: value }), 140);
  dom.input?.addEventListener('input', (event) => onInput(event.target.value));
  dom.clear?.addEventListener('click', () => {
    update({ q: '' });
    dom.input?.focus();
  });
  dom.sort?.addEventListener('change', (event) => update({ sort: event.target.value }));
  dom.chips?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category]');
    if (chip) update({ category: chip.dataset.category });
  });
  dom.list?.addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-filters]')) {
      update({ q: '', category: ALL });
      dom.input?.focus();
      return;
    }
    if (event.target.closest('a[download]')) toast('Download started', { tone: 'success' });
  });
}

async function init() {
  if (!dom.list) return;
  readUrl();
  renderChips();
  renderControls();
  bind();
  try {
    resources = [...(await getResources())];
  } catch (error) {
    dom.list.setAttribute('aria-busy', 'false');
    dom.list.innerHTML = errorHtml(error);
    if (dom.summary) dom.summary.textContent = 'Downloads unavailable';
    observeReveals(dom.list);
    return;
  }
  renderChips();
  render();
}

init();
