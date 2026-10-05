// Vault recovery (VAULT-MESSAGING §11.11, MEMBER-API "Vault recovery"):
// for a member who has lost the phone with their VettID app.
//
//  1. Request: this browser makes a non-extractable P-256 key pair
//     (js/recovery-keys.js) and sends the public half. The vault locks at
//     once; the member is emailed a cancel link.
//  2. Pending (24 h): a countdown, and a cancel button.
//  3. Available (24 h): the API releases the code sealed to this browser's
//     key; the page opens it with WebCrypto and draws it as a QR code,
//     locally (js/qr.js). The code is decrypted only while it is shown, is
//     never sent, logged or stored, and is wiped when it is hidden or the
//     page is left.
//  4. Registered: the code was used on the new phone (the API saw the
//     enclave's marker, VAULT-MESSAGING 0.10.6 §11.11.7); no code is shown
//     and the key is deleted. Cancel stays possible until the recovery expires.
//  5. Cancelled / expired: the key is deleted; a new request is possible.

import { get, post } from './api.js';
import { $, chip, el, fill } from './dom.js';
import * as keys from './recovery-keys.js';
import { SealError, codeGroups, fromBase64, openSealedCode, qrPayload, toBase64 } from './recovery-code.js';
import { qrModules, qrSvg } from './qr.js';
import * as ui from './ui.js';
import { dateTime, timeUntil } from './vault-text.js';

ui.init();

const root = $('rec');

let vault = null; // VaultStatus | null
let recovery = null; // Recovery | null
let sealed = null; // Uint8Array: the sealed code (ciphertext only)
let keyRec = null; // the stored key that opens it
let openState = null; // null | 'ok' | 'refused' | 'unopenable' | 'nokey'
let refusal = null; // the vault's refusal code ('no_credential')
let hasKey = false; // pending: this browser holds a key that may open the code
let canStore = null; // WebCrypto + IndexedDB usable here
let codeShown = false;
let pollTimer = null;
let tickTimer = null;
let pollWhenVisible = false;

const isActive = (r) => !!r && (r.state === 'pending' || r.state === 'available' || (r.state === 'registered' && Date.parse(r.expires_at) > Date.now()));
/** The code is still to be shown: its key must be kept. */
const needsKey = (r) => !!r && (r.state === 'pending' || r.state === 'available');
/** The vault the recovery belongs to (MEMBER-API 1.1.0 `Recovery.vault_id`; older answers: the status's). */
const recoveryVaultId = () => recovery?.vault_id ?? vault?.vault_id;

// ── Loading ─────────────────────────────────────────────────────────────

async function load({ focus } = {}) {
  clearTimers();
  try {
    const st = await get('/api/vault/status');
    vault = st?.vault ?? null;
    recovery = null;
    if (vault && vault.state !== 'enrolling') {
      recovery = (await get('/api/vault/recovery'))?.recovery ?? null;
    }
  } catch (err) {
    wipeCode();
    if (err.code === 'terms_required') renderTermsRequired();
    else renderLoadError(err);
    return;
  }
  canStore ??= await keys.supported();
  if (canStore) await keys.prune(needsKey(recovery) ? recovery : null);
  await classify();
  render();
  schedule();
  if (focus) $(focus)?.focus();
}

/** Work out what this browser can do with the current recovery (without keeping the code). */
async function classify() {
  sealed = null;
  keyRec = null;
  openState = null;
  refusal = null;
  hasKey = false;
  if (!needsKey(recovery) || !canStore) return;
  let cands = [];
  try {
    cands = await keys.candidates(recovery.recovery_id, recoveryVaultId());
  } catch {
    cands = [];
  }
  hasKey = cands.length > 0;
  if (recovery.state !== 'available' || !recovery.sealed_code) return;
  sealed = fromBase64(recovery.sealed_code);
  if (!sealed) {
    openState = 'unopenable';
    return;
  }
  for (const rec of cands) {
    let r;
    try {
      r = await openSealedCode({ privateKey: rec.privateKey, browserKey: rec.browser_key, sealed, vaultId: recoveryVaultId(), recoveryId: recovery.recovery_id });
    } catch (e) {
      if (e instanceof SealError) continue;
      throw e;
    }
    keyRec = rec.recovery_id ? rec : await keys.bindKey(rec, recovery.recovery_id).catch(() => rec);
    if (r.error) {
      openState = 'refused';
      refusal = r.error;
    } else {
      openState = 'ok';
    }
    // The code itself is dropped here; it is opened again only to show it.
    return;
  }
  openState = cands.length ? 'unopenable' : 'nokey';
}

// ── Polling ─────────────────────────────────────────────────────────────
// GET /api/vault/recovery allows 60 a minute; we poll at most once a minute,
// plus once just after the code becomes available.

function clearTimers() {
  clearTimeout(pollTimer);
  clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

function schedule() {
  if (!isActive(recovery)) return;
  let wait = 60_000;
  if (recovery.state === 'pending') {
    wait = Math.min(wait, Math.max(3_000, Date.parse(recovery.available_at) - Date.now() + 3_000));
    tickTimer = setInterval(updateCountdown, 30_000);
  } else if (recovery.state === 'registered') {
    wait = Math.min(wait, Math.max(3_000, Date.parse(recovery.expires_at) - Date.now() + 3_000));
  } else if (!recovery.sealed_code) {
    wait = 15_000;
  } else {
    wait = Math.min(wait, Math.max(3_000, Date.parse(recovery.expires_at) - Date.now() + 3_000));
  }
  pollTimer = setTimeout(poll, wait);
}

async function poll() {
  if (document.hidden) {
    pollWhenVisible = true;
    return;
  }
  let next;
  try {
    next = (await get('/api/vault/recovery'))?.recovery ?? null;
  } catch {
    schedule();
    return;
  }
  const same = next && recovery && next.recovery_id === recovery.recovery_id && next.state === recovery.state && !!next.sealed_code === !!recovery.sealed_code;
  if (same) {
    // Nothing changed: keep the page (and a code on screen) as it is.
    recovery = next;
    schedule();
    return;
  }
  const before = recovery?.state;
  await load();
  if (before === 'pending' && recovery?.state === 'available') ui.showNotice('Your recovery code is ready.', 'info');
  else if (before === 'available' && recovery?.state === 'registered') ui.showNotice('Your recovery code was used on your new phone.', 'info');
  else if (before && isActive({ state: before }) && !isActive(recovery)) ui.showNotice('The recovery is no longer in progress.', 'info');
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pollWhenVisible) {
    pollWhenVisible = false;
    poll();
  }
});

function updateCountdown() {
  const node = $('countdown');
  if (node && recovery?.state === 'pending') node.textContent = timeUntil(recovery.available_at);
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

function render() {
  wipeCode();
  if (!vault) {
    fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-rec' },
      sectionHead('h-rec', 'No vault to recover'),
      el('p', {}, "Your account doesn't have a vault. To set one up, see the Vault tab in your account."),
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: '/account/#vault' }, 'Go to your vault'))));
    return;
  }
  if (vault.state === 'enrolling') {
    fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-rec' },
      sectionHead('h-rec', 'Nothing to recover yet'),
      el('p', {}, "Your vault's setup isn't finished, so there is nothing to recover. Finish the setup in the VettID app, or start it again there."),
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: '/account/#vault' }, 'Go to your vault'))));
    return;
  }
  if (!isActive(recovery)) {
    renderRequest();
    return;
  }
  if (recovery.state === 'pending') renderPending();
  else if (recovery.state === 'registered') renderRegistered();
  else renderAvailable();
}

function renderLoadError(err) {
  fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-rec' },
    sectionHead('h-rec', 'Recover your vault'),
    el('p', {}, "We couldn't load your recovery. ", ui.errorText(err)),
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn btn-primary', on: { click: () => load({ focus: 'h-rec' }) } }, 'Try again'))));
}

function renderTermsRequired() {
  fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-rec' },
    sectionHead('h-rec', 'Accept the current terms first'),
    el('p', {}, 'Recovering a vault needs a membership with the current membership terms accepted. Review and accept them in your account, then come back here.'),
    el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: '/account/#membership' }, 'Review the terms'))));
}

// ── 1. Request ──────────────────────────────────────────────────────────

function renderRequest() {
  const ended = recovery && !isActive(recovery)
    ? el('p', { class: 'muted' }, `Your last recovery, requested ${dateTime(recovery.requested_at)}, ${endedText(recovery.state)}.`)
    : null;

  const explain = el('section', { class: 'card', 'aria-labelledby': 'h-rec' },
    sectionHead('h-rec', 'Before you start'),
    ended,
    callout('info', 'Still have your old phone?',
      "Don't use recovery. Move VettID with a direct transfer, started from the app on your old phone: it needs your vault PIN and credential password, and no waiting."),
    el('ul', { class: 'rec-points' },
      el('li', {}, el('strong', {}, 'Recovery is for a lost phone. '), "It's how a new phone takes over when the phone with your VettID app is gone."),
      el('li', {}, el('strong', {}, 'Your vault locks right away. '), "During the recovery your old app can't open it. Unlocking it there with your vault PIN cancels the recovery."),
      el('li', {}, el('strong', {}, 'There is a 24-hour wait. '), "We email you a link to cancel, in case it wasn't you."),
      el('li', {}, el('strong', {}, 'Then a one-time code appears here, '), 'as a QR code, for 24 hours. It opens only in this browser on this computer: use a regular (not private) window, and don\'t clear this site\'s data until you\'re done.'),
      el('li', {}, el('strong', {}, 'Your new phone needs '), 'the VettID app, the code, your vault PIN and your credential password.'),
      el('li', {}, el('strong', {}, 'The new app replaces the old one, '), 'which is removed and can no longer use your vault. Desktops and agents you paired stay paired.'),
    ),
    callout('warn', 'If your sealed backup is off',
      "There is no copy of your credential to hand over. You won't need your credential password, but your Protean Credential and every critical item are lost: the new app can only start a new credential or delete the vault."),
    neverAsk(),
  );

  let action;
  if (canStore === false) {
    action = el('section', { class: 'card', 'aria-labelledby': 'h-rec-start' },
      sectionHead('h-rec-start', 'Start a recovery'),
      callout('error', "This browser can't keep the recovery key",
        'Recovery needs a private key that stays in this browser for up to 48 hours (IndexedDB and Web Crypto). Private windows and some privacy settings block that. Open this page in a regular window of an up-to-date browser.'));
  } else {
    const box = el('input', { type: 'checkbox', id: 'rec-agree' });
    const submit = el('button', { type: 'submit', class: 'btn btn-danger-solid', disabled: true }, 'Lock my vault and start recovery');
    box.addEventListener('change', () => {
      submit.disabled = !box.checked;
    });
    const form = el('form', {},
      ui.checkRow(box, "I've lost the phone with my VettID app. I understand that my vault locks now and that the code is ready here in 24 hours."),
      el('div', { class: 'actions' }, submit, el('a', { class: 'btn', href: '/account/#vault' }, 'Not now')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (box.checked) startRecovery(form);
    });
    action = el('section', { class: 'card', 'aria-labelledby': 'h-rec-start' }, sectionHead('h-rec-start', 'Start a recovery'), form);
  }
  fill(root, explain, action);
}

function endedText(state) {
  if (state === 'cancelled') return 'was cancelled';
  if (state === 'registered') return 'was used on a new phone';
  return 'expired';
}

function recoveryErrorText(err) {
  switch (err?.code) {
    case 'recovery_active': return 'A recovery is already in progress.';
    case 'terms_required': return 'Accept the current membership terms in your account first.';
    case 'not_found': return "Your account has no set-up vault to recover.";
    case 'release_starting': return "Your vault's software is starting. Try again in about 30 seconds.";
    case 'release_unavailable': return "Your vault's release is no longer available, so it can't be recovered. Email support@vettid.org.";
    case 'conflict': return 'Something changed in the meantime. Reload the page and try again.';
    default: return ui.errorText(err);
  }
}

async function startRecovery(form) {
  const ok = await ui.confirm({
    title: 'Lock your vault and start a recovery?',
    body: [
      'Your vault locks now. In 24 hours, a one-time recovery code appears on this page, in this browser.',
      "We'll email you a link to cancel. Your old app can also cancel by unlocking the vault.",
    ],
    confirmLabel: 'Start recovery',
    tone: 'danger',
  });
  if (!ok) return;
  let created = null;
  const res = await ui.busy(form, async () => {
    try {
      created = await keys.createKey(vault.vault_id);
    } catch {
      throw new Error("This browser couldn't make or keep the recovery key. Use a regular window of an up-to-date browser and try again.");
    }
    return post('/api/vault/recovery', { browser_key: toBase64(created.browser_key) });
  }, {
    busyLabel: 'Starting…',
    onError: async (err) => {
      // A definite refusal: the key is useless. After a network failure the
      // request may still have gone through; keep the key for that case.
      if (created && err?.status && err.status !== 0) await keys.deleteKey(created.id).catch(() => {});
      ui.showError(err?.status === undefined ? err.message : recoveryErrorText(err));
      if (err?.code === 'recovery_active') load();
    },
  });
  if (!res) return;
  try {
    await keys.bindKey(created, res.recovery_id);
  } catch {
    /* the unbound key is still tried when the code is opened */
  }
  await load({ focus: 'h-rec' });
  ui.showNotice(`Recovery started. Your vault is locked, and the code will be ready here on ${dateTime(res.available_at)}. We've emailed you a link to cancel.`);
}

// ── 2. Pending ──────────────────────────────────────────────────────────

function cancelButton(label = 'Cancel recovery') {
  const b = el('button', { type: 'button', class: 'btn btn-danger' }, label);
  b.addEventListener('click', () => cancelRecovery(b));
  return b;
}

async function cancelRecovery(b) {
  const ok = await ui.confirm({
    title: 'Cancel the recovery?',
    body: [
      'The recovery code stops working. Your vault stays locked, and your old app can unlock it again with your vault PIN.',
      'You can start a new recovery afterwards; it starts a new 24-hour wait.',
    ],
    confirmLabel: 'Cancel recovery',
    cancelLabel: 'Keep it',
    tone: 'danger',
  });
  if (!ok) return;
  const id = recovery.recovery_id;
  const res = await ui.busy(b, () => post('/api/vault/recovery/cancel', { recovery_id: id }), { busyLabel: 'Cancelling…' });
  if (!res) return;
  wipeCode();
  await keys.deleteKey(id).catch(() => {});
  await load({ focus: 'h-rec' });
  // MEMBER-API 1.1.0: {cancelled: false} when the recovery had already ended.
  if (res.cancelled === false) ui.showNotice('There was nothing left to cancel: this recovery had already ended.', 'info');
  else ui.showNotice("The recovery is cancelled. We've emailed you a confirmation.");
}

function noKeyCallout() {
  return callout('error', "This browser can't open the code",
    'The recovery code opens only in the browser where the recovery was started, and only while that browser keeps this site\'s data. This browser doesn\'t have the key: it may be a different browser or computer, a private window, or the site data was cleared.',
    'If you can, come back here in the browser you started from. Otherwise cancel this recovery and start a new one here; that starts a new 24-hour wait.');
}

function renderPending() {
  fill(root,
    el('section', { class: 'card', 'aria-labelledby': 'h-rec' },
      sectionHead('h-rec', 'Recovery in progress'),
      el('p', {}, chip('Waiting', 'warn'), ' ', 'Your vault is locked. The recovery code will be ready here in ',
        el('span', { id: 'countdown' }, timeUntil(recovery.available_at)), '.'),
      facts([
        ['Requested', when(recovery.requested_at)],
        ['Code ready', when(recovery.available_at)],
        ['Code expires', when(recovery.expires_at)],
      ]),
      canStore && hasKey
        ? el('p', { class: 'next-step note' }, 'Come back in this browser on this computer: only it can open the code. Keep this site\'s data until you\'re done.')
        : noKeyCallout(),
      el('p', { class: 'muted' }, "Didn't ask for this? Cancel now. We also emailed you a link to cancel."),
      el('div', { class: 'actions' }, cancelButton()),
    ),
  );
}

// ── 3. Available ────────────────────────────────────────────────────────

function renderAvailable() {
  const head = sectionHead('h-rec', 'Your recovery code');
  const times = facts([
    ['Requested', when(recovery.requested_at)],
    ['Code expires', when(recovery.expires_at)],
  ]);

  if (!recovery.sealed_code) {
    fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-rec' }, head,
      el('p', { class: 'loading' }, "Your vault hasn't handed over the code yet. This page checks again every few seconds."),
      times,
      el('div', { class: 'actions' }, cancelButton())));
    return;
  }

  if (openState === 'refused') {
    fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-rec' }, head,
      callout('error', "Your vault can't be recovered",
        refusal === 'no_credential'
          ? 'It has no Protean Credential, and a vault without a credential cannot be recovered.'
          : `Your vault refused the recovery (${refusal}).`,
        'Cancel this recovery so that your vault can be unlocked again. If you no longer have your app, email support@vettid.org.'),
      el('div', { class: 'actions' }, cancelButton())));
    return;
  }

  if (openState !== 'ok') {
    fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-rec' }, head,
      openState === 'nokey' || !canStore
        ? noKeyCallout()
        : callout('error', "The code couldn't be opened here",
          "This browser's key doesn't open it. Either the recovery was started in another browser, or your vault couldn't prepare a code.",
          'Cancel this recovery and start a new one here; that starts a new 24-hour wait.'),
      times,
      el('div', { class: 'actions' }, cancelButton())));
    return;
  }

  const show = el('button', { type: 'button', class: 'btn btn-primary', id: 'show-code', 'aria-controls': 'code-box', 'aria-expanded': 'false' }, 'Show the code');
  show.addEventListener('click', () => showCode(show));

  fill(root,
    el('section', { class: 'card', 'aria-labelledby': 'h-rec' }, head,
      el('p', {}, chip('Ready', 'ok'), ' ', 'Scan this code with the VettID app on your new phone. It works once, until ', when(recovery.expires_at), '.'),
      el('ol', { class: 'howto' },
        el('li', {}, 'On your new phone, install VettID and sign in to this account with the link we email you.'),
        el('li', {}, 'When the app says your account already has a vault, choose to recover it, and scan the code below (or type it).'),
        el('li', {}, 'Enter your vault PIN, then your credential password. Your old app is removed. (With the sealed backup off, the app asks for no password: it offers a new credential or deleting the vault.)'),
      ),
      callout('warn', 'Keep this code to yourself',
        "With this code, your vault PIN and your credential password, someone could take over your vault. Don't share it, photograph it or take a screenshot. Show it only while you scan it."),
      el('div', { class: 'actions' }, show),
      el('div', { id: 'code-box', class: 'code-box', hidden: true }),
      neverAsk(),
    ),
    el('section', { class: 'card', 'aria-labelledby': 'h-rec-cancel' },
      sectionHead('h-rec-cancel', "Didn't ask for this?"),
      el('p', {}, 'Cancel the recovery. Your old app can then unlock your vault again.'),
      el('div', { class: 'actions' }, cancelButton())),
  );
}

async function showCode(btn) {
  if (codeShown) {
    wipeCode();
    btn.focus();
    return;
  }
  let r;
  try {
    r = await openSealedCode({ privateKey: keyRec.privateKey, browserKey: keyRec.browser_key, sealed, vaultId: recoveryVaultId(), recoveryId: recovery.recovery_id });
  } catch {
    ui.showError("The code couldn't be opened. Reload the page and try again.");
    return;
  }
  if (!r.code) return;
  const box = $('code-box');
  const groups = codeGroups(r.code);
  fill(box,
    qrSvg(qrModules(qrPayload(recoveryVaultId(), recovery.recovery_id, r.code)), 'Recovery QR code for the VettID app'),
    el('p', { class: 'code-label', id: 'code-label' }, 'Or type this code:'),
    el('p', { class: 'code-text', 'aria-labelledby': 'code-label' }, groups.flatMap((g, i) => [i ? ' ' : null, el('span', {}, g)])),
  );
  box.hidden = false;
  codeShown = true;
  btn.textContent = 'Hide the code';
  btn.setAttribute('aria-expanded', 'true');
}

/** Remove the code from the page and drop every reference to it. */
function wipeCode() {
  const box = $('code-box');
  if (box) {
    box.replaceChildren();
    box.hidden = true;
  }
  const btn = $('show-code');
  if (btn) {
    btn.textContent = 'Show the code';
    btn.setAttribute('aria-expanded', 'false');
  }
  codeShown = false;
}

// ── 4. Registered ───────────────────────────────────────────────────────

function renderRegistered() {
  fill(root,
    el('section', { class: 'card', 'aria-labelledby': 'h-rec' },
      sectionHead('h-rec', 'Recovery code used'),
      el('p', {}, chip('Used', 'ok'), ' ', 'Your recovery code was used on your new phone. It no longer works, and this page no longer shows it.'),
      el('p', {}, 'On the new phone, the VettID app finishes the recovery with your vault PIN and then your credential password. When it is done, your old app is removed.'),
      facts([
        ['Requested', when(recovery.requested_at)],
        ['Recovery ends', when(recovery.expires_at)],
      ]),
      neverAsk(),
    ),
    el('section', { class: 'card', 'aria-labelledby': 'h-rec-cancel' },
      sectionHead('h-rec-cancel', "Wasn't that your phone?"),
      el('p', {}, 'Cancel the recovery now. The phone that used the code loses its access, and your old app can unlock your vault again.'),
      el('div', { class: 'actions' }, cancelButton())),
  );
}

// Leaving the page (or the browser freezing it in its back/forward cache):
// wipe the code; coming back reloads the state.
window.addEventListener('pagehide', () => {
  wipeCode();
  clearTimers();
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted) load();
});

load();
