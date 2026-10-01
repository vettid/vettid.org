// 6b. Audit log viewer — by month, or by actor / subject.

import { el, mono, muted, time } from '../dom.js';

const currentMonth = () => new Date().toISOString().slice(0, 7);

function compact(detail) {
  if (!detail || typeof detail !== 'object') return '';
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('  ');
}

export function render(root, { api, ui }) {
  const month = el('input', { type: 'month', name: 'month', value: currentMonth(), pattern: '\\d{4}-\\d{2}', placeholder: 'YYYY-MM' });
  const actor = el('input', { type: 'text', name: 'actor', autocomplete: 'off', spellcheck: 'false', placeholder: 'admin email' });
  const subject = el('input', { type: 'text', name: 'subject', autocomplete: 'off', spellcheck: 'false', placeholder: 'guid, email or code' });
  const clear = el('button', { type: 'button', class: 'btn' }, 'Clear filters');
  const form = el('form', { class: 'filters', role: 'search' },
    ui.field('Month', month),
    ui.field('Actor (exact)', actor),
    ui.field('Subject (exact)', subject),
    el('div', { class: 'field field-btn' }, el('button', { type: 'submit', class: 'btn' }, 'Show'), clear),
  );
  const scope = el('p', { class: 'muted scope' });

  function query() {
    const a = actor.value.trim();
    const s = subject.value.trim();
    if (a || s) {
      scope.textContent = `All time, filtered by ${[a && `actor ${a}`, s && `subject ${s}`].filter(Boolean).join(' and ')} (month ignored).`;
      return { actor: a, subject: s };
    }
    const m = month.value || currentMonth();
    scope.textContent = `Events in ${m}, newest first.`;
    return { month: m };
  }

  const list = ui.pagedList({
    columns: ['Time', 'Actor', 'Action', 'Subject', 'Detail'],
    emptyText: 'No audit events for this filter.',
    makePager: () => api.pager('/admin/audit', query()),
    row: (ev) => [
      time(ev.ts),
      ev.actor,
      mono(ev.action),
      ev.subject ? mono(ev.subject) : muted('—'),
      el('code', { class: 'mono detail' }, compact(ev.detail)),
    ],
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    list.reload();
  });
  clear.addEventListener('click', () => {
    actor.value = '';
    subject.value = '';
    month.value = currentMonth();
    list.reload();
  });

  root.append(ui.sectionHead('Audit log', 'Every mutating admin call is recorded.'), form, scope, list.node);
  list.reload();
}
