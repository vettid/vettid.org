// 6a. Admins — list, add (SES sandbox two-step), disable/enable/remove.

import { el, chip, mono, muted, time } from '../dom.js';

const same = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

export function render(root, { api, ui, me }) {
  const email = el('input', { type: 'email', name: 'email', required: true, autocomplete: 'off', spellcheck: 'false', placeholder: 'name@vettid.org' });
  const form = el('form', { class: 'card form-grid' },
    el('h3', {}, 'Add admin'),
    ui.field('Email', email, 'Two steps while SES is in sandbox: the first submit sends an SES verification email; submit the same address again after they click it.'),
    el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn-primary' }, 'Add admin')),
  );
  const outcome = el('div', { class: 'card result', hidden: true, role: 'status' });

  const list = ui.pagedList({
    columns: ['Email', 'Cognito status', 'Enabled', 'Created', 'Actions'],
    emptyText: 'No admins found.',
    makePager: () => api.pager('/admin/admins'),
    row: (a, row) => {
      const id = api.seg(a.email);
      const self = same(a.email, me.email);
      const actions = self
        ? muted('you')
        : ui.rowActions(
            a.enabled
              ? ui.action('Disable', async () => {
                  const ok = await ui.confirm({ title: 'Disable admin', body: [`Disable ${a.email}? They will not be able to sign in.`], confirmLabel: 'Disable', tone: 'danger' });
                  if (!ok) return;
                  row.update(await api.post(`/admin/admins/${id}/disable`));
                  ui.toast(`Disabled ${a.email}.`);
                })
              : ui.action('Enable', async () => {
                  row.update(await api.post(`/admin/admins/${id}/enable`));
                  ui.toast(`Enabled ${a.email}.`);
                }),
            ui.action('Remove', async () => {
              const ok = await ui.confirm({ title: 'Remove admin', body: [`Remove ${a.email} from the admin pool? This deletes their admin sign-in.`], confirmLabel: 'Remove', tone: 'danger' });
              if (!ok) return;
              await api.del(`/admin/admins/${id}`);
              row.remove();
              ui.toast(`Removed ${a.email}.`);
            }, 'danger'),
          );
      return [
        el('span', {}, a.email, self ? ' ' : null, self ? chip('you', 'info') : null),
        mono(a.status),
        a.enabled ? chip('enabled', 'ok') : chip('disabled', 'mute'),
        time(a.created_at),
        actions,
      ];
    },
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ui.busy(form, async () => {
      const addr = email.value.trim();
      const res = await api.post('/admin/admins', { email: addr });
      if (res?.status === 'verification_sent') {
        outcome.replaceChildren(
          el('h3', {}, 'Step 1 of 2 done: verification sent'),
          el('p', {}, `SES sent a verification email to ${addr}. Because SES is in sandbox mode, we can only email verified addresses.`),
          el('p', {}, 'Ask them to click the link in that email, then submit the same address here again to create the admin account.'),
        );
        ui.toast('Verification email sent.');
      } else if (res?.status === 'created') {
        outcome.replaceChildren(
          el('h3', {}, 'Admin created'),
          el('p', {}, `${addr} was added. Cognito has emailed them a temporary password; they set a new password (and MFA) at first sign-in.`),
        );
        if (res.admin) list.prepend(res.admin);
        else list.reload();
        email.value = '';
        ui.toast('Admin created.');
      } else {
        throw new Error('Unexpected response from the API.');
      }
      outcome.hidden = false;
    });
  });

  root.append(ui.sectionHead('Admins', 'Admin accounts in the admin Cognito pool. You cannot disable or remove yourself.'), form, outcome, list.node);
  list.reload();
}
