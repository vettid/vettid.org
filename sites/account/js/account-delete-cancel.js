// The cancel link from the "Your VettID account will be deleted" email
// (MEMBER-API 2.14.0; ACCOUNT-ADMIN-PLAN §5.4.4):
//   https://account.vettid.org/account/delete/cancel/#t=<token>
// No session needed (POST /api/account/deletion/cancel-link {token}). As for
// the other emailed links, the token is in the fragment, so it never reaches
// a server log; we take it out of the address bar (and the history entry)
// before anything else, keep it only in this closure, and send it only to
// that route, only when the member clicks: a mail scanner that opens the
// page does nothing. The page knows nothing until then.

import { publicPost } from './api.js';
import { $, el, fill } from './dom.js';
import * as ui from './ui.js';

ui.init();

// <user_guid>.<32 random bytes, base64url> (lambda/shared/requests.ts).
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
const t = new URLSearchParams(String(location.hash ?? '').replace(/^#/, '')).get('t');
const token = t && TOKEN_RE.test(t) ? t : null;
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

const card = $('cancel-card');
const head = (title) => el('h2', { id: 'h-cancel', tabindex: '-1' }, title);
const GONE = 'This link no longer works: the deletion was already cancelled, or carried out.';
const FAILED = "We couldn't cancel the deletion just now. Try the link again in a few minutes; it keeps working until your account is deleted.";

function done(cancelled) {
  fill(card,
    head(cancelled ? 'Your account is open again' : 'Nothing to cancel'),
    el('p', {}, cancelled ? 'Your account is open again. Sign in as before.' : GONE),
    el('div', { class: 'actions' }, el('a', { class: cancelled ? 'btn btn-primary' : 'btn', href: '/signin/' }, 'Sign in')),
  );
  $('h-cancel').focus();
}

function start() {
  if (!token) {
    fill(card,
      head("This link doesn't work"),
      el('p', {}, GONE),
      el('p', {}, 'If the deletion is still scheduled, open the link from the email we sent you, and use the whole link: the part after # is needed. Or write to ',
        el('a', { href: 'mailto:support@vettid.org' }, 'support@vettid.org'), '.'),
    );
    return;
  }
  const btn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Cancel the deletion');
  btn.addEventListener('click', async () => {
    const res = await ui.busy(btn, () => publicPost('/api/account/deletion/cancel-link', { token }), {
      busyLabel: 'Cancelling…',
      onError: (err) => {
        if (err?.status === 404) done(false);
        else ui.showError(FAILED);
      },
    });
    if (res) done(res.cancelled === true);
  });
  fill(card,
    head('Keep your VettID account?'),
    el('p', {}, 'Someone asked, from your account, to delete it. If you want to keep it, cancel the deletion.'),
    el('div', { class: 'actions' }, btn),
  );
}

start();
