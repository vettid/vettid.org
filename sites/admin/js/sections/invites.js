// 3. Invites — create codes, list, expire, delete.

import { el, chip, mono, muted, time } from '../dom.js';

const STATUS_TONE = { active: 'ok', expired: 'mute', exhausted: 'warn' };

async function copy(ui, code) {
  try {
    await navigator.clipboard.writeText(code);
    ui.toast('Code copied.');
  } catch {
    ui.showError('Clipboard unavailable — select the code and copy it manually.');
  }
}

export function render(root, { api, ui }) {
  const maxUses = el('input', { type: 'number', name: 'max_uses', inputmode: 'numeric', min: 1, max: 1000, value: '1', required: true });
  const days = el('input', { type: 'number', name: 'expires_in_days', inputmode: 'numeric', min: 1, max: 365, value: '30', required: true });
  const note = el('input', { type: 'text', name: 'note', maxlength: 200, autocomplete: 'off', placeholder: 'Who or what this is for' });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Create invite');
  const form = el('form', { class: 'card form-grid' },
    el('h3', {}, 'New invite'),
    ui.field('Max uses (1–1000)', maxUses),
    ui.field('Expires in days (1–365)', days),
    ui.field('Note', note),
    el('div', { class: 'form-actions' }, submit),
  );
  const created = el('div', { class: 'card result', hidden: true, role: 'status' });

  const list = ui.pagedList({
    columns: ['Code', 'Note', 'Uses', 'Status', 'Expires', 'Created', 'Actions'],
    emptyText: 'No invites yet.',
    makePager: () => api.pager('/admin/invites'),
    row: (inv, row) => {
      const code = api.seg(inv.code);
      return [
        mono(inv.code),
        inv.note ? inv.note : muted('—'),
        `${inv.uses} / ${inv.max_uses}`,
        chip(inv.status, STATUS_TONE[inv.status] ?? 'mute'),
        time(inv.expires_at),
        el('div', {}, time(inv.created_at), el('div', { class: 'sub' }, inv.created_by)),
        ui.rowActions(
          ui.action('Copy', () => copy(ui, inv.code)),
          inv.status === 'active'
            ? ui.action('Expire', async () => {
                const ok = await ui.confirm({ title: 'Expire invite', body: [`Expire ${inv.code} now? It can no longer be used.`], confirmLabel: 'Expire' });
                if (!ok) return;
                row.update(await api.post(`/admin/invites/${code}/expire`));
                ui.toast(`Expired ${inv.code}.`);
              })
            : null,
          ui.action('Delete', async () => {
            const ok = await ui.confirm({ title: 'Delete invite', body: [`Delete ${inv.code}? This removes it from the list.`], confirmLabel: 'Delete', tone: 'danger' });
            if (!ok) return;
            await api.del(`/admin/invites/${code}`);
            row.remove();
            ui.toast(`Deleted ${inv.code}.`);
          }, 'danger'),
        ),
      ];
    },
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ui.busy(form, async () => {
      const inv = await api.post('/admin/invites', {
        max_uses: Number(maxUses.value),
        expires_in_days: Number(days.value),
        ...(note.value.trim() ? { note: note.value.trim() } : {}),
      });
      created.replaceChildren(
        el('p', {}, 'New invite code:'),
        el('div', { class: 'code-line' },
          mono(inv.code, 'code-big'),
          el('button', { type: 'button', class: 'btn btn-sm', on: { click: () => copy(ui, inv.code) } }, 'Copy'),
        ),
        el('p', { class: 'muted' }, `${inv.max_uses} use(s), expires `, time(inv.expires_at), '.'),
      );
      created.hidden = false;
      list.prepend(inv);
      note.value = '';
      ui.toast('Invite created.');
    });
  });

  root.append(ui.sectionHead('Invites', 'A valid code on a membership request skips the approval queue.'), form, created, list.node);
  list.reload();
}
