// Header light/dark toggle. Shows a moon while the page is light (click ->
// dark) and a sun while it is dark (click -> light). With no stored choice
// the page follows the OS live; a click stores an explicit choice in
// localStorage ('vettid-theme'), a per-device convenience only.

const KEY = 'vettid-theme';
const SVG = 'http://www.w3.org/2000/svg';
const prefersLight = window.matchMedia('(prefers-color-scheme: light)');

// 24x24 stroke glyphs: crescent moon; sun = circle + 8 rays.
const GLYPHS = {
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  sun: [
    'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
    'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2',
    'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4',
  ],
};

function stored() {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function current() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return prefersLight.matches ? 'light' : 'dark';
}

function glyph(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'theme-icon');
  for (const d of GLYPHS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function render(btn) {
  const light = current() === 'light';
  const label = light ? 'Switch to dark theme' : 'Switch to light theme';
  btn.replaceChildren(glyph(light ? 'moon' : 'sun'));
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function choose(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* not persisted; still applies for this page view */
  }
}

const btn = document.getElementById('theme-toggle');
if (btn) {
  render(btn);
  btn.hidden = false;
  btn.addEventListener('click', () => {
    choose(current() === 'light' ? 'dark' : 'light');
    render(btn);
  });
  // Follow the OS live until the user makes a choice.
  prefersLight.addEventListener('change', () => {
    if (!stored()) render(btn);
  });
  // Keep other open admin tabs in step.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    if (e.newValue === 'light' || e.newValue === 'dark') document.documentElement.setAttribute('data-theme', e.newValue);
    else document.documentElement.removeAttribute('data-theme');
    render(btn);
  });
}
