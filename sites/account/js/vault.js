// The account page's Vault tab (MEMBER-API "Vault"): the vault's status as
// the vault service last recorded it (GET /api/vault/status), its release
// and any release notice, a lock button, and — with no vault yet — how to
// set one up in the Android app. Enrollment, unlock and release approval
// happen only in the app; this site never asks for the vault PIN or the
// credential password.

import { get, post } from './api.js';
import { newUlid } from './recovery-code.js';
import { siteConfig } from './site-config.js';
import { $, chip, date, el, fill, mono } from './dom.js';
import * as ui from './ui.js';
import { dateTime, releaseNotice, releaseStatus, vaultState } from './vault-text.js';

const RECOVERY_PAGE = '/account/vault/recovery/';

let getMe = () => null;
let reveal = () => {};
let status = null; // { vault } from the API
let loadState = 'idle'; // idle | loading | error | done
let config = null;

/** Wire the tab. `hooks.getMe()` returns the current Me; `hooks.reveal(id)` focuses an element in another tab. */
export function mountVault(hooks) {
  getMe = hooks.getMe;
  reveal = hooks.reveal;
  siteConfig().then((c) => {
    config = c;
    if (loadState === 'done') render();
  });
}

/** Called when the Vault tab is shown: loads the status the first time. */
export function showVault() {
  if (loadState === 'idle') loadVault();
  else render();
}

/** Re-render with the current Me (terms state may have changed). */
export function renderVault() {
  if (loadState !== 'idle') render();
}

async function loadVault({ focus } = {}) {
  loadState = 'loading';
  render();
  try {
    status = await get('/api/vault/status');
    loadState = 'done';
  } catch (err) {
    loadState = 'error';
    ui.showError(err);
  }
  render();
  if (focus) $(focus)?.focus();
}

function sectionHead(id, title, intro) {
  return el('header', { class: 'sec-head' }, el('h2', { id, tabindex: '-1' }, title), intro ? el('p', {}, intro) : null);
}

function facts(rows) {
  return el('dl', { class: 'facts' }, rows.filter(Boolean).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

function callout(tone, title, ...body) {
  return el('div', { class: `callout callout-${tone}` }, title ? el('p', { class: 'callout-title' }, title) : null, body.map((b) => (typeof b === 'string' ? el('p', {}, b) : b)));
}

const neverAsk = () => el('p', { class: 'muted small never-ask' },
  'VettID never asks for your vault PIN or credential password on this website. Enter them only in the VettID app.');

function render() {
  renderStatus();
  renderHelp();
}

// ── Status ──────────────────────────────────────────────────────────────

function renderStatus() {
  const sec = $('sec-vault');
  if (loadState === 'loading' || loadState === 'idle') {
    fill(sec, sectionHead('h-vault', 'Your vault'), el('p', { class: 'loading' }, 'Loading your vault…'));
    return;
  }
  if (loadState === 'error') {
    fill(sec, sectionHead('h-vault', 'Your vault'),
      el('p', {}, "We couldn't load your vault's status."),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', on: { click: () => loadVault({ focus: 'h-vault' }) } }, 'Try again')));
    return;
  }
  const v = status?.vault;
  if (!v) {
    renderEnrollment(sec);
    return;
  }
  if (v.state === 'enrolling') {
    fill(sec,
      sectionHead('h-vault', 'Your vault'),
      el('p', {}, chip('Setting up', 'warn'), ' ', "Your vault's setup isn't finished."),
      el('p', {}, 'Finish it in the VettID app on your phone. If setup stopped, open the app and choose Try again.'),
      neverAsk(),
      el('div', { class: 'actions' }, refreshButton()),
    );
    return;
  }

  const [label, tone, line] = vaultState(v.state);
  const rel = v.release;
  const [relLabel, relTone] = releaseStatus(rel?.status);
  const releaseCell = v.sealed_release
    ? el('span', {},
      rel?.number ? `Release ${rel.number} ` : 'Release ', rel ? chip(relLabel, relTone) : null,
      el('span', { class: 'muted' }, 'Fingerprint ', mono(`${v.sealed_release.slice(0, 16)}…`, 'hash'),
        ' · ', el('a', { href: config?.releaseLogUrl ?? 'https://vettid.org/security/releases/' }, 'Release log')))
    : el('span', { class: 'muted' }, 'Not sealed to a release yet');

  const recovery = v.recovery
    ? el('span', {},
      v.recovery.state === 'available' ? chip('Code ready', 'warn')
        : v.recovery.state === 'registered' ? chip('Code used', 'warn') : chip('In progress', 'warn'), ' ',
      el('a', { href: RECOVERY_PAGE }, 'View the recovery'))
    : null;

  const notices = [];
  const rn = releaseNotice(rel);
  if (rn) notices.push(callout(rn.tone, rn.title, rn.text));
  if (v.recovery) {
    notices.push(callout('warn', 'A recovery is in progress',
      v.recovery.state === 'available'
        ? 'The recovery code is ready in the browser where the recovery was requested.'
        : v.recovery.state === 'registered'
          ? 'The recovery code was used on your new phone. The new app finishes the recovery with your vault PIN and credential password.'
          : `Your vault stays locked. The recovery code is ready on ${dateTime(v.recovery.available_at)}.`,
      el('p', {}, "If you didn't ask for this, ", el('a', { href: RECOVERY_PAGE }, 'cancel the recovery'), ' now.')));
  }
  if (v.alarm?.kind === 'credential_clone') {
    notices.push(callout('warn', `Last alarm: ${dateTime(v.alarm.at)}`,
      'Your vault saw your Protean Credential presented by another device, refused it and froze credential use. Your app asks you to confirm, then rotates the credential.',
      el('p', {}, "If it wasn't you, change your vault PIN and credential password in the app. If your phone is gone, ", el('a', { href: RECOVERY_PAGE }, 'start a recovery'), '.')));
  }

  const canLock = v.state === 'unlocked' || v.leased;
  fill(sec,
    sectionHead('h-vault', 'Your vault'),
    facts([
      ['Status', el('span', {}, chip(label, tone), line ? el('span', { class: 'muted' }, line) : null)],
      ['Software', releaseCell],
      recovery ? ['Recovery', recovery] : null,
      ['Created', date(v.created_at)],
      ['Last update', v.updated_at ? el('span', {}, dateTime(v.updated_at)) : date(null)],
    ]),
    notices,
    el('p', { class: 'muted small' }, "This is what the vault service last recorded. Your app shows your vault's own view."),
    el('div', { class: 'actions' }, canLock ? lockButton(v) : null, refreshButton()),
  );
}

function refreshButton() {
  const b = el('button', { type: 'button', class: 'btn btn-sm' }, 'Refresh');
  b.addEventListener('click', () => loadVault({ focus: 'h-vault' }));
  return b;
}

function lockButton(v) {
  const b = el('button', { type: 'button', class: 'btn btn-danger' }, 'Lock vault');
  b.addEventListener('click', async () => {
    const ok = await ui.confirm({
      title: 'Lock your vault?',
      body: [
        'Your vault closes now. Anything that needs it waits until you unlock it again in the VettID app with your vault PIN.',
        'Use this if you think your phone or your session is at risk.',
      ],
      confirmLabel: 'Lock vault',
      tone: 'danger',
    });
    if (!ok) return;
    const requestId = newUlid();
    const res = await ui.busy(b, () => post('/api/vault/lock', { vault_id: v.vault_id, request_id: requestId }), { busyLabel: 'Locking…' });
    if (!res) return;
    const outcome = await ui.busy(b, () => waitForRequest(requestId), { busyLabel: 'Locking…' });
    await loadVault({ focus: 'h-vault' });
    if (outcome === 'done') ui.showNotice('Your vault is locked.');
    else ui.showNotice("We asked your vault to lock but couldn't confirm it yet. Check the status in a minute.", 'warn');
  });
  return b;
}

/** Poll the lock's response slot (≤ 2/s allowed; we use one per 1.5 s, ≤ 30 s). */
async function waitForRequest(requestId) {
  for (let i = 0; i < 20; i += 1) {
    try {
      const r = await get(`/api/vault/requests/${encodeURIComponent(requestId)}`);
      if (r.status === 'done' || r.status === 'expired') return r.status;
    } catch (err) {
      if (err.status !== 429) return 'unknown';
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return 'unknown';
}

// ── No vault: how to set one up ─────────────────────────────────────────

function renderEnrollment(sec) {
  const me = getMe();
  const member = me?.state === 'member';
  const termsOk = member && !me?.terms?.needs_acceptance && !!me?.terms?.accepted_version;
  const ready = member && termsOk;
  const c = config ?? { staging: false, androidAppUrl: null };

  const req = (done, text, action) => el('li', { class: `req ${done ? 'is-done' : 'is-todo'}` },
    el('span', { class: 'req-mark', 'aria-hidden': 'true' }, done ? '✓' : '•'),
    el('span', {}, text, el('span', { class: 'visually-hidden' }, done ? ' (done)' : ' (to do)'), action ? [' ', action] : null));

  const termsAction = !termsOk && me?.terms?.current_version
    ? el('button', { type: 'button', class: 'link-btn', on: { click: () => reveal('h-terms') } }, member ? 'Review the new terms' : 'Accept the terms')
    : null;

  let getApp;
  if (c.staging) {
    getApp = [
      callout('warn', 'This is the staging site',
        `Use the VettID Staging app, the test build: its name says Staging and its welcome screen says STAGING build. It signs in to ${location.host}. The production app doesn't work with this site.`),
      c.androidAppUrl
        ? el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: c.androidAppUrl, rel: 'noopener noreferrer' }, 'Get the VettID Staging app'))
        : el('p', {}, 'Ask the VettID team for the staging build.'),
    ];
  } else {
    getApp = c.androidAppUrl
      ? el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: c.androidAppUrl, rel: 'noopener noreferrer' }, 'Get VettID on Google Play'))
      : el('p', {}, "The VettID app isn't on Google Play yet. We'll email you when you can install it.");
  }

  fill(sec,
    sectionHead('h-vault', 'Your vault', "You don't have a vault yet. Your vault keeps your messages, connections and most important secrets, and only you can open it. You set it up in the VettID app."),
    el('h3', {}, 'What you need'),
    el('ul', { class: 'reqs' },
      req(member, 'A VettID membership'),
      req(termsOk, 'The current membership terms, accepted', termsAction),
      req(false, 'An Android phone with Android 12 or newer'),
    ),
    el('p', { class: 'muted small' }, "A vault doesn't need a subscription."),
    el('h3', { class: 'h3-gap' }, 'Get the app'),
    getApp,
    el('h3', { class: 'h3-gap' }, 'Set up your vault in the app'),
    el('ol', { class: 'howto' },
      el('li', {}, el('strong', {}, 'Install and open the app.')),
      el('li', {}, el('strong', {}, 'Sign in. '), 'Enter the email address of this account and open the sign-in link we email you on your phone. If your account has a sign-in PIN, the app asks for it too.'),
      el('li', {}, el('strong', {}, 'Choose your vault PIN. '), "It unlocks your vault and isn't your sign-in PIN. Use at least 6 digits; avoid dates and simple patterns. Only your vault's sealed enclave ever checks it."),
      el('li', {}, el('strong', {}, 'Create your credential password. '), 'It protects your Protean Credential and your critical items, and the app asks for it at every critical action. Nobody, VettID included, can reset it.'),
      el('li', {}, el('strong', {}, 'Choose your backup. '), 'With the sealed backup on (recommended), your vault keeps a copy sealed to it and to your password, so a recovery can restore your credential if you lose your phone. With it off, your credential lives only on your phone: losing the phone loses your credential and every critical item.'),
    ),
    ready ? null : el('p', { class: 'next-step' }, member
      ? 'Accept the current membership terms first: the app checks them before it sets up a vault.'
      : 'Become a member first: accept the membership terms in the Membership tab.'),
    neverAsk(),
    el('div', { class: 'actions' }, refreshButton()),
  );
}

// ── Recovery and moving phones ──────────────────────────────────────────

function renderHelp() {
  const sec = $('sec-vault-help');
  const v = loadState === 'done' ? status?.vault : null;
  if (!v || v.state === 'enrolling') {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  fill(sec,
    sectionHead('h-vault-help', 'New phone or lost phone'),
    el('div', { class: 'paths' },
      el('div', { class: 'path' },
        el('h3', {}, 'Still have your phone?'),
        el('p', {}, 'Move VettID to your new phone with a direct transfer, started from the app on your current phone. It needs your vault PIN and credential password, and no waiting.')),
      el('div', { class: 'path' },
        el('h3', {}, 'Lost it?'),
        el('p', {}, 'Start a recovery here. Your vault locks at once; after 24 hours your new phone can take over with a one-time code, your vault PIN and your credential password.'),
        el('a', { class: 'btn', href: RECOVERY_PAGE }, v.recovery ? 'View the recovery' : 'Recover your vault')),
    ),
  );
}
