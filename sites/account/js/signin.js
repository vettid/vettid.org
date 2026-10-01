// Sign in: POST /api/auth/start {email}. The API always says ok (no account
// oracle), so the confirmation copy explains why a link might not arrive.

import { get, hasSessionHint, publicPost } from './api.js';
import { $, param } from './dom.js';
import * as ui from './ui.js';

ui.init();

const RESEND_SECONDS = 60;

const form = $('signin-form');
const card = $('signin-card');
const sent = $('sent');
const resend = $('resend');
const submit = form.querySelector('button[type="submit"]');
let email = '';
let stopCooldown = null;

// Notices passed by other pages, then tidy the address bar.
const reasons = {
  canceled:
    'Your account has been canceled and you have been signed out. It will be permanently deleted in 7 days. ' +
    'Changed your mind? Email support@vettid.org before then and we can restore it.',
  expired: 'Your session has ended. Please sign in again.',
  signedout: 'You have signed out.',
};
const reason = Object.keys(reasons).find((k) => param(k) === '1');
if (reason) {
  ui.showNotice(reasons[reason], reason === 'canceled' ? 'warn' : 'info');
  history.replaceState(null, '', location.pathname);
} else if (hasSessionHint()) {
  // Already signed in? Skip the form.
  get('/api/account/me', { redirect: false }).then(
    () => location.replace('/account/'),
    () => {},
  );
}

function startCooldown(button, seconds, label) {
  stopCooldown?.();
  stopCooldown = ui.cooldown(button, seconds, label);
}

function rateLimitCooldown(button) {
  return (err) => {
    ui.showError(err);
    if ((err.code === 'rate_limited' || err.status === 429) && err.retry_after) {
      queueMicrotask(() => startCooldown(button, err.retry_after, (s) => `Try again in ${ui.waitText(s)}`));
    }
  };
}

async function sendLink(button) {
  const res = await ui.busy(button, () => publicPost('/api/auth/start', { email }), {
    busyLabel: 'Sending…',
    onError: rateLimitCooldown(button),
  });
  return res !== undefined;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  email = form.elements.email.value.trim();
  if (!email) return;
  if (!(await sendLink(submit))) return;
  $('sent-to').textContent = email;
  card.hidden = true;
  sent.hidden = false;
  sent.focus();
  startCooldown(resend, RESEND_SECONDS, (s) => `Send another link (${s}s)`);
});

resend.addEventListener('click', async () => {
  if (!(await sendLink(resend))) return;
  ui.showNotice(`We sent another sign-in link to ${email}. Use the newest one.`, 'ok');
  startCooldown(resend, RESEND_SECONDS, (s) => `Send another link (${s}s)`);
});

$('change-email').addEventListener('click', () => {
  stopCooldown?.();
  stopCooldown = null;
  ui.clearMessages();
  sent.hidden = true;
  card.hidden = false;
  form.elements.email.select();
  form.elements.email.focus();
});
