// Vault service pause (docs/ADMIN-API.md "Vault service"): the operator's
// off switch for the member API's vault routes. Paused, enroll, unlock and
// recovery are refused with "temporarily unavailable"; status, lock and
// recovery cancels keep working; no vault, key or manifest is touched.

import { el, chip, muted, time } from '../dom.js';

const PAUSE_BODY = [
  'Members will not be able to set up, unlock or recover a vault until you resume. Locking, status and recovery cancels keep working, and vaults already unlocked keep running until they lock.',
  'Nothing is deleted or changed: no vault, key, manifest or release. The member API follows within about 30 seconds, and the security alerts are emailed.',
];

const RESUME_BODY = [
  'Enrollment, unlock and recovery work again within about 30 seconds. Apps retry on their own.',
];

export function render(root, { api, ui }) {
  const card = el('div', { class: 'card', 'aria-live': 'polite' }, el('p', { class: 'loading' }, 'Loading…'));
  root.append(
    ui.sectionHead('Vault service', 'The off switch for the vault routes of the member API (enroll, unlock, recovery). Use it to stop vault activity at once without changing any vault; resume when done.'),
    card,
  );

  function show(s) {
    const paused = !s.enabled;
    const btn = paused
      ? ui.action('Resume the vault service', () => resume(), '')
      : ui.action('Pause the vault service', () => pause(), 'danger');
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', paused ? 'false' : 'true');
    card.replaceChildren(
      el('p', {}, 'Vault service: ', paused ? chip('paused', 'err') : chip('on', 'ok')),
      paused && s.reason ? el('p', {}, 'Reason: ', s.reason) : null,
      s.set_at ? el('p', {}, muted(`${paused ? 'Paused' : 'Last changed'} by ${s.set_by ?? 'unknown'} at `), time(s.set_at)) : el('p', {}, muted('Never paused.')),
      paused ? el('p', {}, muted('Members see only "paused for maintenance", never the reason.')) : null,
      ui.rowActions(btn),
    );
  }

  async function load() {
    try {
      show(await api.get('/admin/vault-service'));
    } catch (err) {
      card.replaceChildren(el('p', {}, "Couldn't load the vault service state."), ui.rowActions(ui.action('Try again', () => load())));
      ui.showError(ui.errorText(err));
    }
  }

  async function pause() {
    const v = await ui.dialog({
      title: 'Pause the vault service',
      body: PAUSE_BODY,
      fields: [{ name: 'reason', label: 'Reason (required; operators only)', type: 'textarea', required: true, maxlength: 500 }],
      confirmLabel: 'Pause the vault service',
      tone: 'danger',
      enableWhen: (x) => x.reason.length > 0,
    });
    if (!v) return;
    show(await api.post('/admin/vault-service/pause', { reason: v.reason }));
    ui.toast('The vault service is paused.');
  }

  async function resume() {
    const ok = await ui.confirm({ title: 'Resume the vault service', body: RESUME_BODY, confirmLabel: 'Resume the vault service' });
    if (!ok) return;
    show(await api.post('/admin/vault-service/resume'));
    ui.toast('The vault service is on again.');
  }

  load();
}
