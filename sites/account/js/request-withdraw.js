// The withdrawal link from the "We have your VettID membership request" email:
//   https://account.vettid.org/request/withdraw/#w=<token>
// (MEMBER-API 2.6.0 "Withdrawing a request": POST
// /api/public/request/withdraw {token}.) The token is in the fragment, so it
// never reaches a server log; we take it out of the address bar (and the
// history entry) before anything else, keep it only in this closure, and
// send it only to that route, only when the person clicks. Opening the page
// changes nothing (mail scanners and link previews open links).
//
// The API answers every token alike, a working one and one that names
// nothing, so this page cannot say which it was either.

import { publicPost } from './api.js';
import { $, el, fill } from './dom.js';
import * as ui from './ui.js';

ui.init();

// <request id>.<43 base64url characters>
const TOKEN_RE = /^#w=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43})$/;

const token = TOKEN_RE.exec(location.hash)?.[1] ?? null;
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

const card = $('withdraw-card');

function head(title) {
  return el('h2', { id: 'h-withdraw', tabindex: '-1' }, title);
}

function done() {
  fill(card,
    head('Done'),
    el('p', {}, 'If this link belonged to a membership request we still hold, the request is withdrawn. Your name is already deleted, and the request and your email address are deleted within 15 minutes.'),
    el('p', {}, 'If the link was used before, or the request has since been approved or deleted, nothing changed. An approved request is an account: sign in to cancel it.'),
    el('p', { class: 'muted' }, 'You can ask to join again at any time.'),
    el('div', { class: 'actions' }, el('a', { class: 'btn', href: 'https://vettid.org' }, 'vettid.org')),
  );
  $('h-withdraw').focus();
}

if (!token) {
  fill(card,
    head("This link doesn't work"),
    el('p', {}, 'Open the link from the email “We have your VettID membership request”. Use the whole link: the part after # is needed.'),
    el('p', {}, 'A request whose email address was never confirmed needs no link: it is deleted by itself after 14 days.'),
  );
  $('h-withdraw').focus();
} else {
  const btn = el('button', { type: 'button', class: 'btn btn-danger-solid' }, 'Withdraw my request');
  btn.addEventListener('click', async () => {
    const res = await ui.busy(btn, () => publicPost('/api/public/request/withdraw', { token }), {
      busyLabel: 'Withdrawing…',
      // Nothing was changed: the button stays, to try again.
      onError: (err) => ui.showError(err),
    });
    if (res) done();
  });
  fill(card,
    head('Withdraw your request to join VettID?'),
    el('p', {}, 'This deletes your membership request, with your name and email address. Nobody has to do anything by hand, and you can ask to join again later.'),
    el('p', {}, "If you didn't ask to join VettID, withdraw the request: somebody typed your address."),
    el('div', { class: 'actions' }, btn),
  );
}
