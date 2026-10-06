// The cancel link from the "your vault will be deleted" email (MEMBER-API
// 2.1.0, VAULT-MESSAGING 0.16.0 §11.11.9):
//   https://account.vettid.org/vault/deletion/cancel#t=<token>
// No session needed (POST /api/vault/deletion/cancel-link {token}). As for
// the recovery's link: the token is in the fragment, so it never reaches a
// server log; we take it out of the address bar (and the history entry)
// before anything else, keep it only in this closure, and send it only to
// that route, only when the member clicks.

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
    head(cancelled ? 'Deletion cancelled' : 'Nothing left to cancel'),
    cancelled
      ? el('p', {}, "The deletion of your vault is cancelled, and we've emailed you a confirmation. Your vault and everything in it stay as they are.")
      : el('p', {}, 'This deletion had already been cancelled, or its 24 hours are over and the vault is being deleted. Nothing changed.'),
    el('p', {}, "If you didn't ask to delete your vault, someone may be able to read your email or use your VettID account:"),
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
    el('p', {}, 'To cancel a deletion that is still scheduled, sign in and open Vault in your account, or use the VettID app.'),
    el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: '/signin/' }, 'Sign in')),
  );
  $('h-cancel').focus();
}

if (!token) {
  invalid('Open the cancel link from the email we sent you when the deletion was requested. Use the whole link: the part after # is needed.');
} else {
  const btn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Cancel the deletion');
  btn.addEventListener('click', async () => {
    const res = await ui.busy(btn, () => publicPost('/api/vault/deletion/cancel-link', { token }), {
      busyLabel: 'Cancelling…',
      onError: (err) => {
        if (err.status === 404) invalid('It may belong to a deletion that has ended (its 24 hours are over), or the link is wrong.');
        else if (err.status === 400) invalid('It looks incomplete. Copy the whole link from the email, including the part after #.');
        else ui.showError(err);
      },
    });
    if (res) done(res.cancelled === true);
  });
  fill(card,
    head('Keep your vault?'),
    el('p', {}, 'Someone asked, from your account, to delete your VettID vault and everything in it, to start over with a new one. If that was you, you can ignore this page: the vault is deleted 24 hours after the request.'),
    el('p', {}, "If it wasn't you, or you changed your mind, cancel it. Your vault stays as it is."),
    el('div', { class: 'actions' }, btn),
  );
}
