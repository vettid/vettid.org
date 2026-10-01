// 1. Requests — membership requests awaiting approval (state `requested`).

import { el, chip, mono, muted, time } from '../dom.js';

export function render(root, { api, ui }) {
  const list = ui.pagedList({
    columns: ['Name', 'Email', 'Email verified', 'Invite code', 'Requested', 'Actions'],
    emptyText: 'No pending requests.',
    makePager: () => api.pager('/admin/requests'),
    row: (m, row) => {
      const id = api.seg(m.user_guid);
      const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—';
      return [
        el('div', {}, name, el('div', { class: 'sub' }, mono(m.user_guid))),
        m.email,
        m.email_verified ? chip('verified', 'ok') : chip('unverified', 'warn'),
        m.invite_code ? mono(m.invite_code) : muted('—'),
        time(m.created_at),
        ui.rowActions(
          ui.action('Approve', async () => {
            const ok = await ui.confirm({
              title: 'Approve request',
              body: [
                `Approve ${name} <${m.email}>? Their account is created in the registered state.`,
                m.email_verified ? null : 'Their email is not verified yet, so sign-in emails cannot reach them until they click the SES verification link.',
              ].filter(Boolean),
              confirmLabel: 'Approve',
            });
            if (!ok) return;
            await api.post(`/admin/requests/${id}/approve`);
            row.remove();
            ui.toast(`Approved ${m.email}.`);
          }),
          ui.action('Reject', async () => {
            const v = await ui.dialog({
              title: 'Reject request',
              body: [`Reject the request from ${m.email}?`],
              fields: [{ name: 'reason', label: 'Reason (optional, kept in the audit log)', type: 'textarea', maxlength: 500 }],
              confirmLabel: 'Reject',
              tone: 'danger',
            });
            if (!v) return;
            await api.post(`/admin/requests/${id}/reject`, v.reason ? { reason: v.reason } : {});
            row.remove();
            ui.toast(`Rejected ${m.email}.`);
          }),
          m.email_verified
            ? null
            : ui.action('Resend verification', async () => {
                await api.post(`/admin/requests/${id}/resend-verification`);
                ui.toast(`Verification email re-sent to ${m.email}.`);
              }),
        ),
      ];
    },
  });

  root.append(
    ui.sectionHead('Requests', 'Membership requests made without a valid invite code, oldest first. Approving creates the account (registered); the member becomes a member once they accept the current terms.'),
    list.node,
  );
  list.reload();
}
