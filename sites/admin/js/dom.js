// Tiny DOM helpers. All text goes in via text nodes; there is deliberately no
// HTML-string path anywhere in this app.

// Set as properties. value/checked/selected stay attributes so form.reset()
// returns to them (except <textarea>, whose value has no attribute form).
const PROPS = new Set(['disabled', 'hidden', 'required', 'readOnly']);

/**
 * el('button', { class: 'btn', type: 'button', on: { click: fn } }, 'Label')
 * - `class` -> className, `for` -> htmlFor, `on` -> addEventListener map
 * - null / undefined / false attribute values are skipped
 * - children: Nodes, strings/numbers (as text), arrays (flattened), null/false skipped
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'for') node.htmlFor = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (PROPS.has(k) || (k === 'value' && tag === 'textarea')) node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  return add(node, children);
}

export function add(node, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function option(value, label, selected = false) {
  return el('option', { value, selected }, label);
}

/** ISO-8601 -> "YYYY-MM-DD HH:MM UTC" inside a <time>, full ISO on hover. */
export function time(iso) {
  if (!iso) return el('span', { class: 'muted' }, '—');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return el('span', {}, iso);
  const text = d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  return el('time', { datetime: iso, title: iso }, text);
}

/** Status chip. tone: ok | warn | err | info | mute */
export function chip(text, tone = 'mute') {
  return el('span', { class: `chip chip-${tone}` }, text);
}

export function mono(text, extraClass = '') {
  return el('code', { class: `mono ${extraClass}`.trim(), title: text || null }, text ?? '—');
}

export function muted(text) {
  return el('span', { class: 'muted' }, text);
}
