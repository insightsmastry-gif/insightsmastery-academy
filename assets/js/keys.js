/**
 * Global keyboard shortcuts.
 *
 *   /        focus the page search field
 *   t        toggle theme
 *   g h      go home            g n  notes
 *   g r      resources          g a  about
 *   ?        shortcut help dialog
 *   Esc      close dialog / blur search
 *
 * Shortcuts never fire while typing in a field, and every action they expose
 * is also reachable by pointer + tab order.
 */

import { toggleTheme } from './theme.js';

/** Resolved from this module's URL so `g` routes work from any page depth (e.g. a nested 404). */
const SITE_ROOT = new URL('../../', import.meta.url);
const ROUTES = Object.fromEntries(
  Object.entries({ h: 'index.html', n: 'notes.html', r: 'resources.html', a: 'about.html' }).map(
    ([key, page]) => [key, new URL(page, SITE_ROOT).href]
  )
);
const STORAGE_KEY = 'im-shortcuts';
let awaitingGo = false;
let goTimer;

/** WCAG 2.1.4: single-character shortcuts can be switched off (Esc always works). */
function shortcutsEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function setShortcutsEnabled(enabled) {
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'off');
  } catch {
    /* storage blocked — preference lasts for this page only */
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function dialog() {
  return document.querySelector('[data-shortcuts-dialog]');
}

function openHelp() {
  const node = dialog();
  if (!node) return;
  const toggle = node.querySelector('[data-shortcuts-toggle]');
  if (toggle) toggle.checked = shortcutsEnabled();
  if (typeof node.showModal === 'function' && !node.open) node.showModal();
}

function closeHelp() {
  const node = dialog();
  if (node?.open) node.close();
}

function focusSearch() {
  const field = document.querySelector('[data-search-input]');
  if (!field) return false;
  field.focus();
  field.select?.();
  return true;
}

function onKeydown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'Escape') {
    if (dialog()?.open) {
      closeHelp();
      return;
    }
    if (isTypingTarget(document.activeElement)) document.activeElement.blur();
    return;
  }

  if (isTypingTarget(event.target) || !shortcutsEnabled()) return;

  if (awaitingGo) {
    const route = ROUTES[event.key.toLowerCase()];
    awaitingGo = false;
    clearTimeout(goTimer);
    if (route) {
      event.preventDefault();
      window.location.href = route;
    }
    return;
  }

  switch (event.key) {
    case '/':
      if (focusSearch()) event.preventDefault();
      break;
    case 't':
    case 'T':
      event.preventDefault();
      toggleTheme();
      break;
    case 'g':
    case 'G':
      awaitingGo = true;
      clearTimeout(goTimer);
      goTimer = setTimeout(() => {
        awaitingGo = false;
      }, 1200);
      break;
    case '?':
      event.preventDefault();
      openHelp();
      break;
    default:
      break;
  }
}

document.addEventListener('keydown', onKeydown);
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-shortcuts-open]')) {
    event.preventDefault();
    openHelp();
  }
  if (event.target.closest('[data-shortcuts-close]')) {
    event.preventDefault();
    closeHelp();
  }
});
document.addEventListener('change', (event) => {
  const toggle = event.target.closest?.('[data-shortcuts-toggle]');
  if (!toggle) return;
  setShortcutsEnabled(toggle.checked);
  awaitingGo = false;
});
