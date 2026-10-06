// Set up your vault (MEMBER-API 2.0.0 "The account site's vault pages",
// VAULT-MESSAGING 0.15.0 §11.12.1): the portal issues a setup code, the
// VettID app redeems it. The app never signs in.
//
//  - A code is issued only when the member presses "Get a setup code"
//    (POST /api/vault/enroll-code), never on page load, and never while the
//    operator has paused the vault service.
//  - It is shown as the §11.12.1 QR (the QR secret, drawn in the page by the
//    vendored generator) and as XXXX-XXXX text (typed in the app together
//    with this account's email), with a 5-minute countdown, "Cancel code"
//    (DELETE) and, on a phone, "Open in the VettID app" (the App Link with
//    the QR secret in the fragment; never the typed code).
//  - While it is live the page polls GET /api/vault/enroll-code every 5 s.
//    The code is removed from the page when it is used, cancelled or
//    expires, and on pagehide. A reload does not show it again: the member
//    gets a new one. Nothing here stores, logs or sends either secret.

import { del, get, post } from './api.js';
import { $, chip, el, fill } from './dom.js';
import { appLink, formatCode, mmss, setupQrPayload } from './enroll-code.js';
import { qrModules, qrSvg } from './qr.js';
import { siteConfig } from './site-config.js';
import * as ui from './ui.js';
import { dateTime, servicePaused } from './vault-text.js';

ui.init();

const root = $('setup');
const POLL_MS = 5_000;

let status = null; // { vault, service }
let config = null;
let issued = null; // { secret, code, expiresAt } while shown; dropped when wiped
let typedBlocked = false;
let pollTimer = null;
let tickTimer = null;

const onPhone = () => /Android/i.test(navigator.userAgent) || (globalThis.matchMedia?.('(pointer: coarse)').matches ?? false);

// ── Loading ─────────────────────────────────────────────────────────────

async function load() {
  try {
    [status, config] = await Promise.all([get('/api/vault/status'), siteConfig()]);
  } catch (err) {
    fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-setup' },
      head('h-setup', 'Set up your vault'),
      el('p', {}, "We couldn't load your vault's status."),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', on: { click: load } }, 'Try again'))));
    ui.showError(err);
    return;
  }
  renderStart();
}

// ── Rendering ───────────────────────────────────────────────────────────

function head(id, title) {
  return el('header', { class: 'sec-head' }, el('h2', { id, tabindex: '-1' }, title));
}

function callout(tone, title, ...body) {
  return el('div', { class: `callout callout-${tone}` }, title ? el('p', { class: 'callout-title' }, title) : null, body.map((b) => (typeof b === 'string' ? el('p', {}, b) : b)));
}

const neverAsk = () => el('p', { class: 'muted small never-ask' },
  'Only enter this in your own VettID app. VettID will never ask you for it.');

function appDownload() {
  const c = config ?? { staging: false, androidAppUrl: null };
  if (c.androidAppUrl) {
    return el('p', {}, "Don't have the app yet? ",
      el('a', { href: c.androidAppUrl, rel: 'noopener noreferrer' }, c.staging ? 'Get the VettID Staging app' : 'Get VettID on Google Play'), '.');
  }
  return el('p', { class: 'muted' }, c.staging ? 'Ask the VettID team for the staging build of the app.' : "The VettID app isn't on Google Play yet.");
}

/** Before a code is issued (and after one ended). */
function renderStart(ended = null) {
  wipe();
  const paused = servicePaused(status);
  const v = status?.vault;
  const hasVault = !!v && v.state !== 'enrolling';
  const button = el('button', { type: 'button', class: 'btn btn-primary', id: 'get-code' }, ended ? 'Get a new setup code' : 'Get a setup code');
  button.addEventListener('click', () => issue(button));
  fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-setup' },
    head('h-setup', 'Get a setup code'),
    hasVault ? callout('warn', 'You already have a vault',
      "A vault that's set up is never replaced by a new setup. To move VettID to a new phone, use the transfer in the app on your current phone, or a recovery if that phone is gone.",
      el('p', {}, el('a', { href: '/account/vault/recovery/' }, 'Recover your vault'))) : null,
    ended,
    paused ? callout(paused.tone, paused.title, paused.text) : null,
    el('ol', { class: 'howto' },
      el('li', {}, el('strong', {}, 'Open the VettID app on your phone '), 'and choose to set up a vault.'),
      el('li', {}, el('strong', {}, 'Get a setup code here. '), 'It works once, for 5 minutes.'),
      el('li', {}, el('strong', {}, 'Scan the QR code with the app, '), "or type the 8-character code together with this account's email address."),
      el('li', {}, el('strong', {}, 'Check the account the app shows '), "(the first letter of your email and its domain), then choose your vault PIN and credential password in the app.")),
    appDownload(),
    paused ? null : el('div', { class: 'actions' }, button),
    neverAsk(),
  ));
}

async function issue(button) {
  const res = await ui.busy(button, () => post('/api/vault/enroll-code'), {
    busyLabel: 'Getting a code…',
    onError: (err) => {
      if (err.code === 'terms_required') {
        fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-setup' },
          head('h-setup', 'Accept the membership terms first'),
          el('p', {}, 'A setup code needs a membership with the current terms accepted.'),
          el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: '/account/#membership' }, 'Go to Membership'))));
        $('h-setup').focus();
      } else if (err.code === 'vault_unavailable' && err.status === 503) {
        status = { ...status, service: 'paused' };
        renderStart();
        ui.showError('The vault service is paused for maintenance. Try again later.');
      } else {
        ui.showError(err);
      }
    },
  });
  if (!res || typeof res.secret !== 'string' || typeof res.code !== 'string') return;
  let payload;
  try {
    payload = setupQrPayload(location.origin, res.secret);
  } catch {
    ui.showError('Something went wrong. Please get a new code.');
    return;
  }
  issued = { secret: res.secret, code: res.code, expiresAt: Date.parse(res.expires_at), payload };
  typedBlocked = false;
  renderCode();
  schedule();
}

/** The code on screen: QR, typed code, countdown, cancel, App Link on a phone. */
function renderCode() {
  if (!issued) return;
  const cancel = el('button', { type: 'button', class: 'btn btn-danger' }, 'Cancel code');
  cancel.addEventListener('click', () => cancelCode(cancel));
  const box = el('div', { id: 'code-box', class: 'code-box' },
    qrSvg(qrModules(issued.payload), 'Setup QR code for the VettID app'),
    typedBlocked
      ? el('p', { class: 'code-label' }, 'Typing this code is blocked. Scan the QR code, or get a new code.')
      : [
        el('p', { class: 'code-label', id: 'code-label' }, "Or type this code in the app, with this account's email:"),
        el('p', { class: 'code-text', 'aria-labelledby': 'code-label' }, formatCode(issued.code)),
      ],
    el('p', { class: 'muted small', 'aria-live': 'off' }, 'Expires in ', el('span', { id: 'countdown' }, mmss(issued.expiresAt - Date.now()))));
  const sameDevice = onPhone()
    ? el('a', { class: 'btn btn-primary', href: appLink(location.origin, issued.secret), rel: 'noopener' }, 'Open in the VettID app')
    : null;
  fill(root, el('section', { class: 'card', 'aria-labelledby': 'h-setup' },
    head('h-setup', 'Your setup code'),
    el('p', {}, chip('Ready', 'ok'), ' ', 'Scan it with the VettID app on your phone. It works once, for 5 minutes.'),
    typedBlocked ? callout('warn', 'Many wrong codes were typed for this code',
      'Someone tried many wrong codes for your account. Scan the QR code instead, or cancel this code and get a new one. We emailed you about it.') : null,
    box,
    el('div', { class: 'actions' }, sameDevice, cancel),
    callout('warn', 'Keep this code to yourself',
      "Anyone who uses it in the next 5 minutes can set up a vault in your account. Don't share it, photograph it or take a screenshot."),
    neverAsk(),
  ));
  $('h-setup').focus();
}

/** Remove the code from the page and drop every reference to it. */
function wipe() {
  clearTimeout(pollTimer);
  clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
  issued = null;
  const box = $('code-box');
  if (box) box.replaceChildren();
}

function schedule() {
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1_000);
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, POLL_MS);
}

function tick() {
  if (!issued) return;
  const left = issued.expiresAt - Date.now();
  const node = $('countdown');
  if (node) node.textContent = mmss(left);
  if (left <= 0) ended('expired');
}

async function poll() {
  if (!issued) return;
  let r;
  try {
    r = (await get('/api/vault/enroll-code'))?.enroll_code ?? null;
  } catch {
    pollTimer = setTimeout(poll, POLL_MS);
    return;
  }
  if (!issued) return;
  if (!r || r.state !== 'live') {
    ended(r?.state ?? 'expired', r);
    return;
  }
  if (r.typed_blocked && !typedBlocked) {
    typedBlocked = true;
    renderCode();
  }
  pollTimer = setTimeout(poll, POLL_MS);
}

function ended(state, r = null) {
  wipe();
  const text = {
    used: ['Your code was used', `A phone used your setup code${r?.used_at ? ` at ${dateTime(r.used_at)}` : ''}. Finish the setup in the VettID app. If that wasn't you, email support@vettid.org.`],
    revoked: ['Code cancelled', 'This code no longer works.'],
    expired: ['Your code expired', 'Setup codes work for 5 minutes. Get a new one when your phone is ready.'],
  }[state] ?? ['Your code no longer works', 'Get a new code to set up your vault.'];
  renderStart(callout(state === 'used' ? 'info' : 'warn', text[0], text[1]));
  $('h-setup')?.focus();
}

async function cancelCode(button) {
  const res = await ui.busy(button, () => del('/api/vault/enroll-code'), { busyLabel: 'Cancelling…' });
  if (!res) return;
  ended(res.revoked ? 'revoked' : 'expired');
}

// Leaving the page (or the browser freezing it in its back/forward cache):
// the code goes; coming back does not show it again.
window.addEventListener('pagehide', () => {
  if (issued) renderStart(callout('info', 'The code was removed from this page', 'Get a new code when your phone is ready.'));
  wipe();
});

load();
