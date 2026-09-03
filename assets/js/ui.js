/**
 * Shared chrome + motion for every page.
 *
 * Owns: sticky header state, mobile nav, active nav link, footer year,
 * scroll-reveal, count-up numbers, copy-to-clipboard, toasts, smooth anchors.
 * All animation respects `prefers-reduced-motion`.
 */

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- header ------------------------------------------------------------------
function initHeader() {
  const header = document.querySelector('[data-site-header]');
  if (!header) return;
  const onScroll = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

// --- mobile nav --------------------------------------------------------------
function initMobileNav() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const panel = document.querySelector('[data-nav-panel]');
  if (!toggle || !panel) return;

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-open', open);
    document.documentElement.classList.toggle('has-nav-open', open);
    if (open) {
      panel.querySelector('a, button')?.focus({ preventScroll: true });
    }
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  panel.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 860) setOpen(false);
  });
}

// --- active nav link ---------------------------------------------------------
function initActiveNav() {
  const page = document.body.dataset.page;
  if (!page) return;
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const isActive = link.dataset.nav === page;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

// --- footer year -------------------------------------------------------------
function initYear() {
  const year = String(new Date().getFullYear());
  document.querySelectorAll('[data-year]').forEach((node) => {
    node.textContent = year;
  });
}

// --- scroll reveal -----------------------------------------------------------
/**
 * Reveal elements marked `data-reveal` as they enter the viewport.
 * Children of `[data-reveal-group]` are staggered automatically.
 * Safe to call again after injecting new DOM.
 */
export function observeReveals(root = document) {
  const targets = [...root.querySelectorAll('[data-reveal]:not(.is-revealed)')];
  if (!targets.length) return;

  root.querySelectorAll('[data-reveal-group]').forEach((group) => {
    [...group.querySelectorAll('[data-reveal]')].forEach((child, index) => {
      if (!child.style.getPropertyValue('--reveal-delay')) {
        const step = Number(group.dataset.revealStep || 70);
        child.style.setProperty('--reveal-delay', `${index * step}ms`);
      }
    });
  });

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    targets.forEach((target) => target.classList.add('is-revealed'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
  );
  targets.forEach((target) => observer.observe(target));
}

// --- count-up ----------------------------------------------------------------
/** Animate `[data-count-to]` elements once they scroll into view. */
export function observeCounters(root = document) {
  const counters = [...root.querySelectorAll('[data-count-to]:not(.is-counted)')];
  if (!counters.length) return;

  const run = (node) => {
    node.classList.add('is-counted');
    const target = Number(node.dataset.countTo || 0);
    const suffix = node.dataset.countSuffix || '';
    const decimals = Number(node.dataset.countDecimals || 0);
    if (prefersReducedMotion()) {
      node.textContent = target.toFixed(decimals) + suffix;
      return;
    }
    const duration = Number(node.dataset.countDuration || 1100);
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = (target * eased).toFixed(decimals) + suffix;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if (!('IntersectionObserver' in window)) {
    counters.forEach(run);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        run(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.4 }
  );
  counters.forEach((counter) => observer.observe(counter));
}

// --- toast -------------------------------------------------------------------
let toastTimer;
/** Show a transient status message (screen-reader announced). */
export function toast(message, { tone = 'default', duration = 2600 } = {}) {
  let host = document.querySelector('[data-toast-host]');
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('data-toast-host', '');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  host.innerHTML = '';
  const node = document.createElement('div');
  node.className = `toast toast--${tone}`;
  node.textContent = message;
  host.append(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 250);
  }, duration);
}

// --- clipboard ---------------------------------------------------------------
/** Copy text, with a document.execCommand fallback for non-secure contexts. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

function initCopyButtons() {
  document.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-copy]');
    if (!trigger) return;
    event.preventDefault();
    const value = trigger.dataset.copy === 'url' ? window.location.href : trigger.dataset.copy;
    const ok = await copyText(value);
    toast(ok ? 'Link copied to clipboard' : 'Copy failed — select and copy manually', {
      tone: ok ? 'success' : 'error',
    });
  });
}

// --- smooth in-page anchors --------------------------------------------------
function initSmoothAnchors() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href').slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
    history.replaceState(null, '', `#${id}`);
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}

// --- page-in transition ------------------------------------------------------
function initPageEnter() {
  document.documentElement.classList.add('is-ready');
}

function boot() {
  initHeader();
  initMobileNav();
  initActiveNav();
  initYear();
  initCopyButtons();
  initSmoothAnchors();
  observeReveals();
  observeCounters();
  initPageEnter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
