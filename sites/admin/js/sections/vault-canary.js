// Vault canary testers (docs/ADMIN-API.md "Vault canary"): members routed
// to `canary` vault releases, i.e. unpublished builds under test
// (VAULT-RELEASES §10.1 step 9). The toggle lives on each member's row in
// the Members section; this module also renders the list of testers below it.

import { el, chip, mono } from '../dom.js';

const STATUS_TONE = { active: 'ok', suspended: 'warn', canceled: 'err' };

const SET_BODY = (email) => [
  `${email} will be routed to unreleased canary vault builds: a new vault enrolls into the newest canary release while one exists, and a vault sealed to a canary release stays on it.`,
  'Canary builds are not published yet and may fail or be withdrawn. Only flag a tester who has agreed to this.',
];

const CLEAR_BODY = (email) => [
  `${email} will be routed to published vault releases only.`,
  'If their vault is sealed to a canary release that is never published, it becomes unreachable once the flag is cleared. Clear the flag after the release is published or the tester has moved off it.',
];

/** Confirm, then set or clear. Resolves to the new CanaryView, or null if cancelled. */
async function change(api, ui, m, on) {
  const ok = await ui.confirm(on
    ? { title: 'Make vault canary tester', body: SET_BODY(m.email), confirmLabel: 'Route to canary builds', tone: 'danger' }
    : { title: 'End vault canary testing', body: CLEAR_BODY(m.email), confirmLabel: 'Clear canary flag' });
  if (!ok) return null;
  const path = `/admin/vault-canary/${api.seg(m.user_guid)}`;
  const v = on ? await api.post(path) : await api.del(path);
  ui.toast(on ? `${m.email} is now a vault canary tester.` : `${m.email} is no longer a vault canary tester.`);
  return v;
}

/**
 * The "Vault canary" switch for a Members row: shown for members, and for
 * anyone already flagged so a stray flag can be cleared. onChange(view) runs
 * after a successful change.
 */
export function toggle(m, { api, ui }, onChange) {
  if (m.state !== 'member' && !m.vault_canary) return null;
  const on = !!m.vault_canary;
  const btn = ui.action('', async () => {
    const v = await change(api, ui, m, !on);
    if (v) onChange(v);
  }, on ? 'danger' : '');
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  btn.append('Vault canary ', el('span', { 'aria-hidden': 'true', class: 'switch-state' }, on ? 'on' : 'off'));
  return btn;
}

/** Renders the testers list into root; returns { reload } and calls onCleared(view) after a removal. */
export function renderList(root, { api, ui }, onCleared) {
  const list = ui.pagedList({
    columns: ['Member', 'Email', 'State', 'Status', 'Actions'],
    emptyText: 'No vault canary testers.',
    makePager: () => api.pager('/admin/vault-canary'),
    row: (m, row) => {
      const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—';
      const clear = ui.action('Clear flag', async () => {
        const v = await change(api, ui, m, false);
        if (!v) return;
        row.remove();
        onCleared(v);
      });
      return [
        el('div', {}, name, el('div', { class: 'sub' }, mono(m.user_guid))),
        m.email,
        m.eligible ? chip(m.state, 'ok') : chip(`${m.state} (not eligible)`, 'warn'),
        chip(m.account_status, STATUS_TONE[m.account_status] ?? 'mute'),
        ui.rowActions(clear),
      ];
    },
  });
  root.append(
    ui.sectionHead('Vault canary testers', 'Members routed to canary vault releases (unpublished builds under test). Turn the flag on from a member\'s row above.'),
    list.node,
  );
  list.reload();
  return { reload: () => list.reload() };
}
