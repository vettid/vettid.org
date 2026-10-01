// 2. Members — search/list registered + member accounts; suspend, reinstate,
// delete, extend subscription.

import { el, chip, mono, muted, option, time } from '../dom.js';

const STATE_TONE = { requested: 'mute', registered: 'info', member: 'ok', rejected: 'err' };
const STATUS_TONE = { active: 'ok', suspended: 'warn', canceled: 'err' };
const SUB_TONE = { trial: 'info', active: 'ok', expired: 'warn', canceled: 'mute' };

function subscriptionCell(s) {
  if (!s) return muted('none');
  return el('div', {},
    el('div', {}, s.type_name, ' ', chip(s.status, SUB_TONE[s.status] ?? 'mute'), s.paid ? ' ' : null, s.paid ? chip('paid', 'info') : null),
    el('div', { class: 'sub' }, 'expires ', time(s.expires_at)),
  );
}

export function render(root, { api, ui }) {
  const state = el('select', { name: 'state' },
    option('', 'Registered + member'), option('registered', 'Registered'), option('member', 'Member'));
  const status = el('select', { name: 'status' },
    option('', 'Any'), option('active', 'Active'), option('suspended', 'Suspended'), option('canceled', 'Canceled'));
  const q = el('input', { type: 'search', name: 'q', placeholder: 'e.g. alice@', autocomplete: 'off', spellcheck: 'false' });
  const filters = el('form', { class: 'filters', role: 'search' },
    ui.field('State', state),
    ui.field('Account status', status),
    ui.field('Email starts with', q),
    el('div', { class: 'field field-btn' }, el('button', { type: 'submit', class: 'btn' }, 'Apply')),
  );

  const list = ui.pagedList({
    columns: ['Member', 'Email', 'State', 'Status', 'Subscription', 'Voting', 'Actions'],
    emptyText: 'No members match these filters.',
    makePager: () => api.pager('/admin/members', { state: state.value, status: status.value, q: q.value.trim() }),
    row: (m, row) => {
      const id = api.seg(m.user_guid);
      const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—';
      const suspendOrReinstate = m.account_status === 'active'
        ? ui.action('Suspend', async () => {
            const v = await ui.dialog({
              title: 'Suspend member',
              body: [`Suspending ${m.email} disables sign-in until reinstated.`],
              fields: [{ name: 'reason', label: 'Reason (required)', type: 'textarea', required: true, maxlength: 500 }],
              confirmLabel: 'Suspend',
              tone: 'danger',
              enableWhen: (x) => x.reason.length > 0,
            });
            if (!v) return;
            row.update(await api.post(`/admin/members/${id}/suspend`, { reason: v.reason }));
            ui.toast(`Suspended ${m.email}.`);
          })
        : ui.action('Reinstate', async () => {
            const ok = await ui.confirm({
              title: 'Reinstate member',
              body: [`Re-enable sign-in for ${m.email}?`],
              confirmLabel: 'Reinstate',
            });
            if (!ok) return;
            row.update(await api.post(`/admin/members/${id}/reinstate`));
            ui.toast(`Reinstated ${m.email}.`);
          });

      const extend = m.subscription
        ? ui.action('Extend', async () => {
            const v = await ui.dialog({
              title: 'Extend subscription',
              body: [`${m.email}: ${m.subscription.type_name}, ${m.subscription.status}, expires ${m.subscription.expires_at}.`],
              fields: [{ name: 'days', label: 'Days to add (1–366)', type: 'number', min: 1, max: 366, value: '30', required: true }],
              confirmLabel: 'Extend',
              enableWhen: (x) => Number.isInteger(Number(x.days)) && Number(x.days) >= 1 && Number(x.days) <= 366,
            });
            if (!v) return;
            row.update(await api.post(`/admin/members/${id}/subscription/extend`, { days: Number(v.days) }));
            ui.toast(`Extended ${m.email} by ${v.days} days.`);
          })
        : null;

      const remove = ui.action('Delete', async () => {
        const v = await ui.dialog({
          title: 'Delete member permanently',
          body: [
            `This removes ${m.email}'s sign-in and personal data. Only the audit trail is kept. This cannot be undone.`,
          ],
          fields: [{ name: 'confirm', label: `Type ${m.email} to confirm` }],
          confirmLabel: 'Delete permanently',
          tone: 'danger',
          enableWhen: (x) => x.confirm === m.email,
        });
        if (!v) return;
        await api.del(`/admin/members/${id}`);
        row.remove();
        ui.toast(`Deleted ${m.email}.`);
      }, 'danger');

      return [
        el('div', {}, name, el('div', { class: 'sub' }, mono(m.user_guid))),
        m.email,
        chip(m.state, STATE_TONE[m.state] ?? 'mute'),
        chip(m.account_status, STATUS_TONE[m.account_status] ?? 'mute'),
        subscriptionCell(m.subscription),
        m.voting_rights ? chip('yes', 'ok') : muted('no'),
        ui.rowActions(suspendOrReinstate, extend, remove),
      ];
    },
  });

  filters.addEventListener('submit', (e) => {
    e.preventDefault();
    list.reload();
  });

  root.append(
    ui.sectionHead('Members', 'Registered accounts and members. Voting rights = member + active paid subscription.'),
    filters,
    list.node,
  );
  list.reload();
}
