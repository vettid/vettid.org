// The same-device App Link of a setup code (MEMBER-API 2.0.0,
// ENROLLMENT-CODES §3.2):
//   https://account.vettid.org/vault/enroll/#s=<QR secret>
// With the VettID app installed, Android opens the app instead of this page.
// Without it, this page takes the secret out of the address bar (and the
// history entry) first, offers the app's download link, and can draw the
// same QR from the secret for scanning with another phone. The secret is in
// the fragment, so it never reaches a server or a log; this page never sends
// it anywhere. No session needed.

import { $, el, fill } from './dom.js';
import { secretFromHash, setupQrPayload } from './enroll-code.js';
import { qrModules, qrSvg } from './qr.js';
import { siteConfig } from './site-config.js';
import * as ui from './ui.js';

ui.init();

let secret = secretFromHash(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

const card = $('enroll-card');

function head(title) {
  return el('h2', { id: 'h-enroll', tabindex: '-1' }, title);
}

async function render() {
  const c = await siteConfig();
  const download = c.androidAppUrl
    ? el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: c.androidAppUrl, rel: 'noopener noreferrer' }, c.staging ? 'Get the VettID Staging app' : 'Get VettID on Google Play'))
    : el('p', { class: 'muted' }, c.staging ? 'Ask the VettID team for the staging build of the app.' : "The VettID app isn't on Google Play yet.");

  if (!secret) {
    fill(card,
      head("This link doesn't work"),
      el('p', {}, 'Open the "Open in the VettID app" link from the setup page of your account, on the phone where you use VettID. Setup links work once, for 5 minutes.'),
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: '/account/vault/setup/' }, 'Get a setup code')));
    return;
  }

  const show = el('button', { type: 'button', class: 'btn', id: 'show-qr', 'aria-controls': 'code-box', 'aria-expanded': 'false' }, 'Show the QR code');
  const box = el('div', { id: 'code-box', class: 'code-box', hidden: true });
  show.addEventListener('click', () => {
    if (!box.hidden) {
      wipeQr();
      return;
    }
    if (!secret) return;
    fill(box, qrSvg(qrModules(setupQrPayload(location.origin, secret)), 'Setup QR code for the VettID app'));
    box.hidden = false;
    show.textContent = 'Hide the QR code';
    show.setAttribute('aria-expanded', 'true');
  });

  fill(card,
    head('The VettID app is not installed on this phone'),
    el('p', {}, 'This setup link opens in the VettID app. Install the app, then go back to the setup page of your account and get a new code: this one works only for a few minutes.'),
    download,
    el('p', {}, 'Setting up the vault on another phone? Show the QR code here and scan it with the VettID app on that phone.'),
    el('div', { class: 'actions' }, show),
    box,
    el('p', { class: 'muted small never-ask' }, 'Only use this code in your own VettID app. VettID will never ask you for it.'),
  );
}

function wipeQr() {
  const box = $('code-box');
  if (box) {
    box.replaceChildren();
    box.hidden = true;
  }
  const show = $('show-qr');
  if (show) {
    show.textContent = 'Show the QR code';
    show.setAttribute('aria-expanded', 'false');
  }
}

// Leaving the page: the QR goes, and the secret with it.
window.addEventListener('pagehide', () => {
  wipeQr();
  secret = null;
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted) render();
});

render();
