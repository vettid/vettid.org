// Magic-link landing: /auth/#t=<token>&e=<email>
// The token lives only in the URL fragment (never sent to servers or logs).
// We read it and strip it from the address bar immediately. Nothing is sent
// until the person clicks "Continue": opening the page alone must not sign
// anyone in (an attacker could otherwise sign a victim into the attacker's
// account), and email link scanners that run pages must not burn the
// single-use token. If the account has a PIN, we ask for it next.

import { get, hasSessionHint, publicPost } from './api.js';
import { $, el, fill } from './dom.js';
import * as ui from './ui.js';

ui.init();

// Parse the fragment by hand: URLSearchParams would turn "+" into a space,
// which breaks plus-addressed emails if the link didn't percent-encode them.
function readFragment() {
  const out = {};
  for (const part of location.hash.replace(/^#/, '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    const v = i < 0 ? '' : part.slice(i + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v);
    } catch {
      /* malformed escape — ignore the pair */
    }
  }
  return out;
}

let token = '';
let email = '';

const title = $('auth-title');
const card = $('auth-card');

function signedIn() {
  fill(card, el('p', { class: 'loading' }, 'Signed in. Taking you to your account…'));
  location.replace('/account/');
}

function badLink(text) {
  title.textContent = "This sign-in link didn't work";
  fill(card,
    el('p', {}, text),
    el('p', { class: 'muted' }, 'Sign-in links work once and expire after 15 minutes. If you asked for more than one, only the newest works.'),
    el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: '/signin/' }, 'Get a new sign-in link')),
  );
  title.setAttribute('tabindex', '-1');
  title.focus();
}

async function verify() {
  fill(card, el('p', { class: 'loading' }, 'Checking your sign-in link…'));
  let res;
  try {
    res = await publicPost('/api/auth/verify', { email, token });
  } catch (err) {
    if (err.status === 401 || err.status === 400) {
      badLink('It has expired or has already been used.');
    } else if (err.code === 'rate_limited' || err.status === 429) {
      badLink(ui.errorText(err));
    } else {
      // Network / server trouble: the token may still be good, so offer a retry.
      title.textContent = "We couldn't sign you in";
      fill(card,
        el('p', {}, ui.errorText(err)),
        el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'btn btn-primary', on: { click: verify } }, 'Try again'),
          el('a', { class: 'btn', href: '/signin/' }, 'Get a new link'),
        ),
      );
    }
    return;
  }
  if (res?.status === 'signed_in') signedIn();
  else if (res?.status === 'pin_required') showPin();
  else badLink('Something unexpected happened.');
}

function showPin() {
  title.textContent = 'Enter your PIN';
  const input = ui.pinInput({ name: 'pin' });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Continue');
  const form = el('form', { class: 'form-grid', novalidate: true },
    el('p', {}, 'Your account is protected with a PIN. Enter it to finish signing in.'),
    ui.field('PIN', input, { hint: '4 to 8 digits. You have 5 minutes to enter it.' }),
    el('div', { class: 'actions' }, submit, el('a', { href: '/signin/' }, 'Start over')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = ui.checkPin(input);
    if (!pin) {
      input.focus();
      return;
    }
    const res = await ui.busy(form, () => publicPost('/api/auth/pin', { pin }), {
      busyLabel: 'Checking…',
      onError: (err) => {
        // 401 messages say how many attempts are left, or that it's locked.
        ui.showError(err.status === 401 && !err.message ? 'That PIN is not right.' : err);
        input.value = '';
        input.focus();
      },
    });
    if (res?.status === 'signed_in') signedIn();
  });
  fill(card, form);
  input.focus();
}

/** Ask before using the link; warn if this would switch accounts. */
async function confirmStep() {
  title.textContent = 'Sign in to VettID';
  fill(card, el('p', { class: 'loading' }, 'One moment…'));
  let current = null;
  if (hasSessionHint()) {
    try {
      current = await get('/api/account/me', { redirect: false });
    } catch {
      current = null; // not signed in (the normal case)
    }
  }
  if (current?.email && current.email.toLowerCase() === email.toLowerCase()) {
    title.textContent = "You're already signed in";
    fill(card,
      el('p', {}, 'You are already signed in as ', el('strong', {}, current.email), '.'),
      el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: '/account/' }, 'Go to your account')),
    );
    return;
  }
  const go = el('button', { type: 'button', class: 'btn btn-primary', on: { click: verify } }, 'Continue');
  fill(card,
    el('p', {}, 'Continue signing in as ', el('strong', {}, email), '?'),
    current?.email
      ? el('p', { class: 'muted' }, 'You are currently signed in as ', el('strong', {}, current.email), '. Continuing will switch accounts.')
      : null,
    el('p', { class: 'muted' }, "If you didn't ask for this sign-in link, close this page."),
    el('div', { class: 'actions' }, go, el('a', { href: '/' }, 'Cancel')),
  );
  go.focus();
}

function start() {
  const frag = readFragment();
  token = frag.t ?? '';
  email = (frag.e ?? '').trim();
  // Strip the token from the address bar (and so from history) right away.
  history.replaceState(null, '', location.pathname + location.search);
  ui.clearMessages();
  if (!token || !email) {
    badLink('The link is incomplete. It may have been cut off when it was copied.');
  } else {
    confirmStep();
  }
}

// A newer link opened in this same tab only changes the fragment.
window.addEventListener('hashchange', () => {
  if (location.hash.length > 1) start();
});

start();
