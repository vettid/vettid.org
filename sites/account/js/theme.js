// System / Light / Dark switch in the header. The explicit choice is kept in
// localStorage ('vettid-theme') — the only storage this site uses, purely a
// per-device convenience. "System" removes the key and the data-theme
// attribute, so CSS falls back to prefers-color-scheme.

const KEY = 'vettid-theme';
const MODES = ['system', 'light', 'dark'];
const LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
const SVG = 'http://www.w3.org/2000/svg';

// 24x24 stroke icons: monitor, sun, moon.
const ICONS = {
  system: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  light: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  dark: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
};

function read() {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try {
    if (mode === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, mode);
  } catch {
    /* not persisted; still applies for this page view */
  }
}

function icon(mode) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'theme-icon');
  for (const d of ICONS[mode]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function render(btn, mode) {
  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  const text = document.createElement('span');
  text.className = 'theme-label';
  text.textContent = LABEL[mode];
  btn.replaceChildren(icon(mode), text);
  btn.setAttribute('aria-label', `Color theme: ${LABEL[mode]}. Switch to ${LABEL[next]}.`);
  btn.title = `Theme: ${LABEL[mode]} (switch to ${LABEL[next]})`;
  btn.dataset.mode = mode;
}

const btn = document.getElementById('theme-toggle');
if (btn) {
  let mode = read();
  render(btn, mode);
  btn.hidden = false;
  btn.addEventListener('click', () => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    apply(mode);
    render(btn, mode);
  });
}
