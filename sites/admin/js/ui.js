// Shared UI pieces: error/toast regions, busy buttons, <dialog> prompts,
// form fields, and the paginated table used by every section.

import { el } from './dom.js';

let errorRegion = null;
let toastRegion = null;
let fieldSeq = 0;

export function init({ errors, toasts }) {
  errorRegion = errors;
  toastRegion = toasts;
}

export function errorText(err) {
  return err?.message || 'Something went wrong.';
}

export function showError(message) {
  errorRegion.replaceChildren(
    el('p', {}, message),
    el('button', { type: 'button', class: 'btn btn-sm', on: { click: clearError } }, 'Dismiss'),
  );
}

export function clearError() {
  errorRegion?.replaceChildren();
}

export function toast(message) {
  const node = el('div', { class: 'toast' }, message);
  toastRegion.append(node);
  setTimeout(() => node.classList.add('toast-out'), 3500);
  setTimeout(() => node.remove(), 4000);
}

/**
 * Run an async action with `target` (a button, or a container whose buttons
 * should all lock) disabled. Errors land in the error region.
 */
export async function busy(target, fn) {
  const buttons = target instanceof HTMLButtonElement ? [target] : [...target.querySelectorAll('button')];
  const locked = buttons.filter((b) => !b.disabled);
  for (const b of locked) b.disabled = true;
  target.setAttribute('aria-busy', 'true');
  clearError();
  try {
    return await fn();
  } catch (err) {
    showError(errorText(err));
    return undefined;
  } finally {
    for (const b of locked) b.disabled = false;
    target.removeAttribute('aria-busy');
  }
}

/** Row/inline action button; locks its whole table row while running. */
export function action(label, fn, tone = '') {
  const btn = el('button', { type: 'button', class: `btn btn-sm ${tone ? 'btn-' + tone : ''}`.trim() }, label);
  btn.addEventListener('click', () => busy(btn.closest('tr') ?? btn, () => fn(btn)));
  return btn;
}

export function rowActions(...buttons) {
  return el('div', { class: 'row-actions' }, buttons);
}

/** Labelled form control. */
export function field(label, control, hint) {
  if (!control.id) control.id = `f${++fieldSeq}`;
  const hintNode = hint ? el('p', { class: 'hint', id: `${control.id}-hint` }, hint) : null;
  if (hintNode) control.setAttribute('aria-describedby', hintNode.id);
  if (control.type === 'checkbox') {
    return el('div', { class: 'field field-check' }, control, el('label', { for: control.id }, label), hintNode);
  }
  return el('div', { class: 'field' }, el('label', { for: control.id }, label), control, hintNode);
}

export function sectionHead(title, description) {
  return el('header', { class: 'sec-head' }, el('h2', {}, title), description ? el('p', { class: 'muted' }, description) : null);
}

/**
 * Modal prompt built on <dialog>. Resolves to the field values (or {} with no
 * fields) on confirm, null on cancel/Esc.
 * fields: [{ name, label, type?, required?, min?, max?, value?, hint?, autocomplete? }]
 * enableWhen(values) -> bool keeps the confirm button disabled until true.
 */
export function dialog({ title, body = [], fields = [], confirmLabel = 'Confirm', tone = 'primary', enableWhen }) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const titleId = `dlg${++fieldSeq}`;
    const inputs = {};
    const fieldNodes = fields.map((f) => {
      const attrs = {
        name: f.name,
        required: f.required,
        min: f.min,
        max: f.max,
        value: f.value,
        maxlength: f.maxlength,
        autocomplete: f.autocomplete ?? 'off',
        spellcheck: 'false',
      };
      const input = f.type === 'textarea' ? el('textarea', { ...attrs, rows: 3 }) : el('input', { ...attrs, type: f.type ?? 'text' });
      inputs[f.name] = input;
      return field(f.label, input, f.hint);
    });

    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
    const ok = el('button', { type: 'submit', class: `btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}` }, confirmLabel);
    const cancel = el('button', { type: 'button', class: 'btn' }, 'Cancel');
    const form = el('form', { method: 'dialog', class: 'dlg-form' },
      el('h2', { id: titleId }, title),
      [body].flat().map((p) => (p instanceof Node ? p : el('p', {}, p))),
      fieldNodes,
      el('div', { class: 'dlg-actions' }, cancel, ok),
    );
    const dlg = el('dialog', { class: 'dlg', 'aria-labelledby': titleId }, form);

    let result = null;
    const sync = () => {
      if (enableWhen) ok.disabled = !enableWhen(values());
    };
    form.addEventListener('input', sync);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      result = values();
      dlg.close();
    });
    cancel.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
      resolve(result);
    });

    document.body.append(dlg);
    sync();
    dlg.showModal();
    const first = Object.values(inputs)[0];
    (first ?? (tone === 'danger' ? cancel : ok)).focus();
  });
}

export async function confirm(opts) {
  return (await dialog({ ...opts, fields: [] })) !== null;
}

/**
 * Paginated table with "Load more".
 * makePager() -> api.pager(...); row(item, ctl) -> array of cell contents,
 * where ctl = { update(newItem), remove() } acts on that row.
 */
export function pagedList({ columns, makePager, row, emptyText = 'Nothing here yet.' }) {
  const tbody = el('tbody');
  const status = el('p', { class: 'list-status muted' });
  const more = el('button', { type: 'button', class: 'btn', hidden: true }, 'Load more');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, columns.map((c) => el('th', { scope: 'col' }, c)))),
    tbody,
  );
  const wrap = el('div', { class: 'table-wrap', hidden: true }, table);
  const node = el('div', { class: 'list' }, wrap, status, el('div', { class: 'list-more' }, more));
  let pager = null;
  let generation = 0;

  function syncEmpty() {
    const empty = tbody.childElementCount === 0;
    wrap.hidden = empty;
    if (empty && pager?.done) status.textContent = emptyText;
    else if (!empty) status.textContent = '';
  }

  function fill(tr, item) {
    const ctl = {
      update: (next) => fill(tr, next),
      remove: () => {
        tr.remove();
        syncEmpty();
      },
    };
    tr.replaceChildren(...row(item, ctl).map((cell, i) => el('td', { 'data-col': columns[i] }, cell)));
  }

  function makeRow(item) {
    const tr = el('tr');
    fill(tr, item);
    return tr;
  }

  async function loadMore() {
    const gen = generation;
    const p = pager;
    status.textContent = 'Loading…';
    const items = await busy(more, () => p.next());
    if (gen !== generation) return; // a reload superseded this page
    if (items === undefined) {
      status.textContent = 'Could not load.';
      more.hidden = false;
      return;
    }
    tbody.append(...items.map(makeRow));
    more.hidden = p.done;
    status.textContent = '';
    syncEmpty();
  }

  more.addEventListener('click', loadMore);

  return {
    node,
    reload() {
      generation += 1;
      pager = makePager();
      tbody.replaceChildren();
      wrap.hidden = true;
      more.hidden = true;
      return loadMore();
    },
    prepend(item) {
      tbody.prepend(makeRow(item));
      syncEmpty();
    },
  };
}
