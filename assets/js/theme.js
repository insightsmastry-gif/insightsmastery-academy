/**
 * Theme controller — light (the parent site's look) by default, dark on request.
 *
 * The initial theme is applied by an inline head snippet on every page (to
 * avoid a flash of the wrong theme). This module owns everything after that:
 * toggle wiring and cross-tab sync.
 *
 * Storage key: "im-theme" -> "light" | "dark" | absent (= light)
 */

const STORAGE_KEY = 'im-theme';

/** @returns {"light"|"dark"} the theme currently painted */
export function getTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** @returns {"light"|"dark"|null} explicit user choice, null when none was made */
export function getStoredTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function paint(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1220' : '#f8fafc');
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
    );
    button.setAttribute(
      'title',
      theme === 'dark' ? 'Light theme (T)' : 'Dark theme (T)'
    );
  });
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

/**
 * Set the theme and persist the choice.
 * @param {"light"|"dark"} theme
 * @param {{persist?: boolean}} [options]
 */
export function setTheme(theme, options = {}) {
  const next = theme === 'dark' ? 'dark' : 'light';
  if (options.persist !== false) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode) — theme still applies for this page */
    }
  }
  paint(next);
}

/** Flip between light and dark, animating the swap when supported. */
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && typeof document.startViewTransition === 'function') {
    document.startViewTransition(() => setTheme(next));
    return next;
  }
  setTheme(next);
  return next;
}

function onToggleClick(event) {
  const trigger = event.target.closest('[data-theme-toggle]');
  if (!trigger) return;
  event.preventDefault();
  toggleTheme();
}

// --- wire up -----------------------------------------------------------------
paint(getStoredTheme() ?? 'light');
document.addEventListener('click', onToggleClick);

// Keep tabs in sync.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  paint(getStoredTheme() ?? 'light');
});
