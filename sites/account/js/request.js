// Request membership: POST /api/public/request, then explain the next steps.
// The API never says whether an invite code was accepted beyond the outcome,
// and neither do we.

import { publicPost } from './api.js';
import { $, el, fill, param } from './dom.js';
import * as ui from './ui.js';

ui.init();

const form = $('request-form');
const card = $('request-card');
const result = $('result');
const submit = form.querySelector('button[type="submit"]');
let stopCooldown = null;

// Convenience: /request/?code=ABC123 prefills the invite code field.
const preset = param('code');
if (preset && /^[A-Za-z0-9-]{1,64}$/.test(preset)) form.elements.invite_code.value = preset.toUpperCase();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  const body = {
    first_name: f.first_name.value.trim(),
    last_name: f.last_name.value.trim(),
    email: f.email.value.trim(),
    consent: f.consent.checked,
  };
  const code = f.invite_code.value.trim();
  if (code) body.invite_code = code;

  if (!body.first_name || !body.last_name) {
    ui.showError('Please enter your first and last name.');
    return;
  }
  if (!body.consent) {
    ui.showError('Please tick the email box — we need it to reach you.');
    f.consent.focus();
    return;
  }

  const res = await ui.busy(form, () => publicPost('/api/public/request', body), {
    busyLabel: 'Sending…',
    onError: (err) => {
      ui.showError(err);
      if ((err.code === 'rate_limited' || err.status === 429) && err.retry_after) {
        stopCooldown?.();
        // busy() re-enables the button after onError; start the cooldown after that.
        queueMicrotask(() => {
          stopCooldown = ui.cooldown(submit, err.retry_after, (s) => `Try again in ${ui.waitText(s)}`);
        });
      }
    },
  });
  if (!res) return;
  showResult(res.outcome, body.email);
});

function awsSteps(email) {
  return el('ol', {},
    el('li', {}, 'Look in your inbox at ', el('strong', {}, email), ' for an email from ', el('strong', {}, 'Amazon Web Services'),
      ' titled “Email Address Verification Request”. It can take a few minutes; check spam or junk too.'),
    el('li', {}, 'Click the link in that email. This lets VettID email you, and it is how you opt in.'),
  );
}

function showResult(outcome, email) {
  if (outcome === 'registered') {
    fill(result,
      el('h2', {}, "You're in."),
      el('p', {}, 'Check your inbox for the Amazon Web Services verification email and click it; then sign in.'),
      awsSteps(email),
      el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: '/signin/' }, 'Sign in')),
    );
  } else {
    // "pending_approval" (and anything unexpected) — an admin will review.
    fill(result,
      el('h2', {}, 'Request received.'),
      el('p', {}, "Click the AWS verification email; an admin will review your request and you'll get an email when approved."),
      awsSteps(email),
      el('p', { class: 'muted' }, "Once you're approved, come back and sign in with this email address."),
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: '/' }, 'Back to start')),
    );
  }
  card.hidden = true;
  result.hidden = false;
  result.focus();
}
