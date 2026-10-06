// "Delete my vault and start over" (MEMBER-API 2.1.0, VAULT-MESSAGING
// 0.16.0 §11.11.9): for a member who has lost the phone with the credential
// backup off (no recovery exists then), or who does not want to recover.
//
//  1. Request: what is lost (everything in the vault, for good), the typed
//     phrase "delete my vault", a confirmation. Nothing is locked or sent to
//     the vault; the member is emailed a cancel link.
//  2. Pending (24 h): a countdown and Cancel (also possible from the email
//     link and the VettID app).
//  3. Executing: the vault is being deleted; once it is gone the page offers
//     Set up your vault (a new setup code, a new, empty vault).
//
// The deletion opens nothing and returns nothing, so it needs no PIN or
// credential password; this site never asks for them.

import { get, post } from './api.js';
import { $, chip, el, fill } from './dom.js';
import * as ui from './ui.js';
import { dateTime, servicePaused, timeUntil } from './vault-text.js';

ui.init();

const PHRASE = 'delete my vault';
const RECOVERY_PAGE = '/account/vault/recovery/';
const SETUP_PAGE = '/account/vault/setup/';
const root = $('del');

let status = null; // { vault, service }
let deletion = null; // Deletion | null
let pollTimer = null;
let tickTimer = null;
let pollWhenVisible = false;
let hadDeletion = false;

// ── Loading ─────────────────────────────────────────────────────────────

async function load({ focus } = {}) {
  clearTimers();
  try {
    status = await get('/api/vault/status');
    deletion = status?.vault ? (await get('/api/vault/deletion'))?.deletion ?? null : null;
  } catch (err) {
    renderLoadError(err);
    return;
  }
  if (deletion) hadDeletion = true;
  render();
  schedule();
  if (focus) $(focus)?.focus();
}

function clearTimers() {
  clearTimeout(pollTimer);
  clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

// While a deletion is pending or executing, check once a minute (the API
// allows 60 a minute), and just after deletes_at.
function schedule() {
  if (!deletion) return;
  let wait = 60_000;
  if (deletion.state === 'pending') {
    wait = Math.min(wait, Math.max(5_000, Date.parse(deletion.deletes_at) - Date.now() + 5_000));
    tickTimer = setInterval(updateCountdown, 30_000);
  }
  pollTimer = setTimeout(poll, wait);
}

async function poll() {
  if (document.hidden) {
    pollWhenVisible = true;
    return;
  }
  await load();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pollWhenVisible) {
    pollWhenVisible = false;
    poll();
  }
});

function updateCountdown() {
  const node = $('countdown');
  if (node && deletion?.state === 'pending') node.textContent = timeUntil(deletion.deletes_at);
}

// ── Rendering ───────────────────────────────────────────────────────────

function sectionHead(id, title, intro) {
  return el('header', { class: 'sec-head' }, el('h2', { id, tabindex: '-1' }, title), intro ? el('p', {}, intro) : null);
}

function facts(rows) {
  return el('dl', { class: 'facts' }, rows.filter(Boolean).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

function callout(tone, title, ...body) {
  return el('div', { class: `callout callout-${tone}` }, title ? el('p', { class: 'callout-title' }, title) : null, body.map((b) => (typeof b === 'string' ? el('p', {}, b) : b)));
}

const when = (iso) => el('time', { datetime: iso }, dateTime(iso));
const neverAsk = () => el('p', { class: 'muted small never-ask' },
  'VettID never asks for your vault PIN or credential password on this website. Enter them only in the VettID app.');
const backToVault = () => el('a', { class: 'btn', href: '/account/#vault' }, 'Back to your vault');

function render() {
  const v = status?.vault ?? null;
  if (!v) {
    renderNoVault();
    return;
  }
  if (v.state === 'enrolling') {
    fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-del' },
      sectionHead('h-del', 'Nothing to delete yet'),
      el('p', {}, "Your vault's setup isn't finished, so there is nothing to delete. A new setup code replaces the unfinished vault: get one on the setup page and scan it with the VettID app."),
      el('div', { class: 'actions' }, servicePaused(status) ? null : el('a', { class: 'btn btn-primary', href: SETUP_PAGE }, 'Get a setup code'), backToVault())));
    return;
  }
  if (deletion?.state === 'executing') renderExecuting();
  else if (deletion?.state === 'pending') renderPending();
  else renderRequest(v);
}

function renderLoadError(err) {
  fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-del' },
    sectionHead('h-del', 'Delete my vault and start over'),
    el('p', {}, "We couldn't load your vault. ", ui.errorText(err)),
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn btn-primary', on: { click: () => load({ focus: 'h-del' }) } }, 'Try again'))));
}

/** No vault (none yet, or the deletion has finished): set up a new one. */
function renderNoVault() {
  const paused = servicePaused(status);
  fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-del' },
    sectionHead('h-del', hadDeletion ? 'Your vault was deleted' : "You don't have a vault"),
    el('p', {}, hadDeletion
      ? "Your old vault and everything in it are gone. Set up a new, empty vault with a setup code and the VettID app."
      : 'There is nothing to delete. You can set up a vault with a setup code and the VettID app.'),
    paused ? callout(paused.tone, paused.title, paused.text) : null,
    el('div', { class: 'actions' }, paused ? null : el('a', { class: 'btn btn-primary', href: SETUP_PAGE }, 'Set up your vault'), backToVault())));
}

// ── 1. Request ──────────────────────────────────────────────────────────

function renderRequest(v) {
  const lost = el('section', { class: 'card', 'aria-labelledby': 'h-del' },
    sectionHead('h-del', 'Before you start'),
    v.credential_backup === false
      ? callout('warn', "Your vault can't be recovered",
        "Its credential backup is off, so there is no recovery: if the phone with your VettID app is gone, this is the only way to a working vault again. If you still have the phone, keep using your vault there instead.")
      : callout('info', 'Lost your phone? A recovery keeps your vault',
        "If your vault's credential backup is on, a recovery moves your vault, with everything in it, to a new phone. Deleting it loses everything.",
        el('p', {}, el('a', { href: RECOVERY_PAGE }, 'Recover your vault instead'))),
    el('ul', { class: 'rec-points' },
      el('li', {}, el('strong', {}, 'Everything in your vault is deleted, for good: '), 'your messages, connections, profile, items, Protean Credential and its critical items, the audit log and the feed. Nobody, VettID included, can restore any of it.'),
      el('li', {}, el('strong', {}, 'Your connections '), "are told you're gone only if your vault is running when it is deleted. Their messages to you stop working."),
      el('li', {}, el('strong', {}, 'There is a 24-hour wait. '), "We email you a link to cancel, in case it wasn't you. You can also cancel here or in the VettID app. Your vault keeps working until then."),
      el('li', {}, el('strong', {}, 'Then you start over: '), 'set up a new, empty vault here with a setup code and the VettID app.'),
    ),
    neverAsk(),
  );

  let action;
  if (v.recovery) {
    action = el('section', { class: 'card', 'aria-labelledby': 'h-del-start' },
      sectionHead('h-del-start', 'A recovery is in progress'),
      el('p', {}, "Your vault can't be deleted while a recovery is in progress. Cancel the recovery first, or let it finish."),
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: RECOVERY_PAGE }, 'View the recovery')));
  } else {
    const input = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'text' });
    const submit = el('button', { type: 'submit', class: 'btn btn-danger-solid', disabled: true }, 'Delete my vault in 24 hours');
    input.addEventListener('input', () => {
      submit.disabled = input.value.trim() !== PHRASE;
    });
    const form = el('form', {},
      ui.field(`To confirm, type “${PHRASE}”`, input, { hint: 'Exactly these three words, in lower case.' }),
      el('div', { class: 'actions' }, submit, backToVault()));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim() === PHRASE) requestDeletion(form);
      else ui.fieldError(input, `Type “${PHRASE}” to confirm.`);
    });
    action = el('section', { class: 'card', 'aria-labelledby': 'h-del-start' }, sectionHead('h-del-start', 'Delete my vault and start over'), form);
  }
  fill(root, lost, action);
}

function deletionErrorText(err) {
  switch (err?.code) {
    case 'deletion_pending': return 'A deletion of your vault is already scheduled.';
    case 'recovery_active': return 'A recovery is in progress. Cancel it first, or let it finish.';
    case 'terms_required': return 'Accept the current membership terms in your account first.';
    case 'not_found': return "Your account has no set-up vault to delete.";
    case 'conflict': return 'Something changed in the meantime. Reload the page and try again.';
    case 'bad_request': return `Type “${PHRASE}” exactly to confirm.`;
    default: return ui.errorText(err);
  }
}

async function requestDeletion(form) {
  const ok = await ui.confirm({
    title: 'Delete your vault in 24 hours?',
    body: [
      'Your vault and everything in it will be deleted 24 hours from now. Nothing can be restored afterwards.',
      "We'll email you a link to cancel. Until then you can also cancel here or in the VettID app.",
    ],
    confirmLabel: 'Delete my vault',
    cancelLabel: 'Keep my vault',
    tone: 'danger',
  });
  if (!ok) return;
  const res = await ui.busy(form, () => post('/api/vault/deletion', { confirm: PHRASE }), {
    busyLabel: 'Scheduling…',
    onError: (err) => {
      ui.showError(deletionErrorText(err));
      if (err?.code === 'deletion_pending' || err?.code === 'recovery_active' || err?.code === 'not_found') load();
    },
  });
  if (!res) return;
  await load({ focus: 'h-del' });
  ui.showNotice(`Your vault will be deleted on ${dateTime(res.deletes_at)}. We've emailed you a link to cancel.`);
}

// ── 2. Pending ──────────────────────────────────────────────────────────

function renderPending() {
  const cancel = el('button', { type: 'button', class: 'btn btn-primary' }, 'Cancel the deletion');
  cancel.addEventListener('click', () => cancelDeletion(cancel));
  fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-del' },
    sectionHead('h-del', 'Your vault will be deleted'),
    el('p', {}, chip('Scheduled', 'warn'), ' ', 'Your vault and everything in it will be deleted in ',
      el('span', { id: 'countdown' }, timeUntil(deletion.deletes_at)), '. Until then it keeps working, and you can cancel.'),
    facts([
      ['Requested', when(deletion.requested_at)],
      ['Deleted on', when(deletion.deletes_at)],
    ]),
    el('p', { class: 'muted' }, "Didn't ask for this, or changed your mind? Cancel now. We also emailed you a link to cancel, and the VettID app can cancel too."),
    el('div', { class: 'actions' }, cancel, backToVault()),
  ));
}

async function cancelDeletion(b) {
  const id = deletion.deletion_id;
  const res = await ui.busy(b, () => post('/api/vault/deletion/cancel', { deletion_id: id }), { busyLabel: 'Cancelling…' });
  if (!res) return;
  hadDeletion = false;
  await load({ focus: 'h-del' });
  if (res.cancelled === false) ui.showNotice('There was nothing left to cancel: the deletion had already started or was cancelled before.', 'info');
  else ui.showNotice("The deletion is cancelled; your vault stays as it is. We've emailed you a confirmation.");
}

// ── 3. Executing ────────────────────────────────────────────────────────

function renderExecuting() {
  fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-del' },
    sectionHead('h-del', 'Your vault is being deleted'),
    el('p', {}, chip('Deleting', 'warn'), ' ', "The 24 hours are over and your vault is being deleted. It can't be cancelled any more. We'll email you when it is gone; then you can set up a new vault here."),
    facts([
      ['Requested', when(deletion.requested_at)],
      ['Deletion started', when(deletion.deletes_at)],
    ]),
    el('p', { class: 'loading' }, 'This page checks again every minute.'),
    el('div', { class: 'actions' }, backToVault()),
  ));
}

window.addEventListener('pagehide', clearTimers);
window.addEventListener('pageshow', (e) => {
  if (e.persisted) load();
});

load();
