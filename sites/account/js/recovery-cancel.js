// The cancel link from the "recovery requested" email:
//   https://account.vettid.org/vault/recovery/cancel#t=<token>
// No session needed (MEMBER-API "Vault recovery": POST
// /api/vault/recovery/cancel-link {token}). The token is in the fragment, so
// it never reaches a server log; we take it out of the address bar (and the
// history entry) before anything else, keep it only in this closure, and
// send it only to that route, only when the member clicks.

import { publicPost } from './api.js';
import { $, el, fill } from './dom.js';
import { tokenFromHash } from './recovery-code.js';
import * as ui from './ui.js';

ui.init();

const token = tokenFromHash(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

const card = $('cancel-card');

function head(title) {
  return el('h2', { id: 'h-cancel', tabindex: '-1' }, title);
}

function done(cancelled) {
  fill(card,
    head(cancelled ? 'Recovery cancelled' : 'Nothing left to cancel'),
    cancelled
      ? el('p', {}, "The recovery of your vault is cancelled, and we've emailed you a confirmation. Your VettID app can unlock your vault again with your vault PIN.")
      : el('p', {}, 'This recovery had already ended: it was cancelled before, or its 48 hours are over. Nothing changed.'),
    el('p', {}, "If you didn't start this recovery, someone may be able to read your email or use your VettID account:"),
    el('ul', { class: 'rec-points' },
      el('li', {}, 'Secure your email account: change its password and turn on two-step sign-in.'),
      el('li', {}, 'Sign in to your VettID account and turn on a sign-in PIN under Security.'),
      el('li', {}, 'Tell us at ', el('a', { href: 'mailto:support@vettid.org' }, 'support@vettid.org'), '.'),
    ),
    el('div', { class: 'actions' }, el('a', { class: 'btn', href: '/signin/' }, 'Sign in to your account')),
  );
  $('h-cancel').focus();
}

function invalid(text) {
  fill(card,
    head("This link doesn't work"),
    el('p', {}, text),
    el('p', {}, 'To cancel a recovery that is still in progress, sign in and open Vault in your account, or unlock your vault in the VettID app: unlocking cancels the recovery.'),
    el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: '/signin/' }, 'Sign in')),
  );
  $('h-cancel').focus();
}

if (!token) {
  invalid('Open the cancel link from the email we sent you when the recovery was requested. Use the whole link: the part after # is needed.');
} else {
  const btn = el('button', { type: 'button', class: 'btn btn-danger-solid' }, 'Cancel the recovery');
  btn.addEventListener('click', async () => {
    const res = await ui.busy(btn, () => publicPost('/api/vault/recovery/cancel-link', { token }), {
      busyLabel: 'Cancelling…',
      onError: (err) => {
        if (err.status === 404) invalid('It may have been used already, or the recovery it belongs to has ended (it was cancelled, or its 48 hours are over).');
        else if (err.status === 400) invalid("It looks incomplete. Copy the whole link from the email, including the part after #.");
        else ui.showError(err);
      },
    });
    // MEMBER-API 1.1.0: {cancelled: boolean}; an older answer ({}) means it was handled.
    if (res) done(res.cancelled !== false);
  });
  fill(card,
    head('Cancel the recovery of your vault?'),
    el('p', {}, 'Someone asked to recover your VettID vault from your account. If that was you on a new phone, you can ignore this page.'),
    el('p', {}, "If it wasn't you, cancel it. Your vault stays locked until your VettID app unlocks it again with your vault PIN."),
    el('div', { class: 'actions' }, btn),
  );
}
