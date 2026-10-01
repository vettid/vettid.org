// 5. Subscription types — create, enable/disable.

import { el, chip, mono, muted, time } from '../dom.js';

export function render(root, { api, ui }) {
  const name = el('input', { type: 'text', name: 'name', required: true, maxlength: 100, autocomplete: 'off' });
  const description = el('textarea', { name: 'description', rows: 2, maxlength: 500 });
  const duration = el('input', { type: 'number', name: 'duration_days', inputmode: 'numeric', min: 1, max: 3660, value: '30', required: true });
  const isTrial = el('input', { type: 'checkbox', name: 'is_trial', checked: true });
  const paid = el('input', { type: 'checkbox', name: 'paid' });
  const form = el('form', { class: 'card form-grid' },
    el('h3', {}, 'New subscription type'),
    ui.field('Name', name),
    ui.field('Duration (days, 1–3660)', duration),
    ui.field('Description', description),
    el('div', { class: 'field-row' },
      ui.field('Free trial', isTrial),
      ui.field('Paid (grants voting rights)', paid),
    ),
    el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn-primary' }, 'Create type')),
  );

  const list = ui.pagedList({
    columns: ['Name', 'Duration', 'Trial', 'Paid', 'Enabled', 'Created', 'Actions'],
    emptyText: 'No subscription types yet.',
    makePager: () => api.pager('/admin/subscription-types'),
    row: (t, row) => {
      const id = api.seg(t.type_id);
      const toggle = t.enabled
        ? ui.action('Disable', async () => {
            row.update(await api.post(`/admin/subscription-types/${id}/disable`));
            ui.toast(`Disabled ${t.name}.`);
          })
        : ui.action('Enable', async () => {
            row.update(await api.post(`/admin/subscription-types/${id}/enable`));
            ui.toast(`Enabled ${t.name}.`);
          });
      return [
        el('div', {}, t.name,
          t.description ? el('div', { class: 'sub' }, t.description) : null,
          el('div', { class: 'sub' }, mono(t.type_id))),
        `${t.duration_days} d`,
        t.is_trial ? chip('trial', 'info') : muted('no'),
        t.paid ? chip('paid', 'info') : muted('no'),
        t.enabled ? chip('enabled', 'ok') : chip('disabled', 'mute'),
        time(t.created_at),
        ui.rowActions(toggle),
      ];
    },
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ui.busy(form, async () => {
      const t = await api.post('/admin/subscription-types', {
        name: name.value.trim(),
        description: description.value.trim(),
        duration_days: Number(duration.value),
        is_trial: isTrial.checked,
        paid: paid.checked,
      });
      list.prepend(t);
      form.reset();
      ui.toast(`Created ${t.name}.`);
    });
  });

  root.append(
    ui.sectionHead('Subscription types', 'Free trials for now; the paid flag is for when payments arrive. Disabled types cannot be newly assigned.'),
    form,
    list.node,
  );
  list.reload();
}
