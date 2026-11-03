// Deleting the VettID account (MEMBER-API 2.14.0 "Deleting the account";
// ACCOUNT-ADMIN-PLAN §5.4). /account/delete/ is stable: the apps open it.
//
//  - Not signed in: sign in first.
//  - A vault, or an unfinished vault setup: it must go first (the page says how).
//  - Otherwise: what is deleted, the mailing-list box (only when the address
//    is on the list; ticked), the phrase, the PIN if one is set, an email
//    code, and Delete my account. The account is closed at once and deleted
//    after 7 days; the email we send has a link that cancels it.
//
// Texts are ACCOUNT-ADMIN-PLAN §5.4.6. The API's own messages are shown for
// the PIN, the code and the limits (they are the same texts).

import { get, post } from './api.js';
import { $, el, fill } from './dom.js';
import * as ui from './ui.js';

ui.init();

const PHRASE = 'delete my account';
const START_OVER = '/account/vault/deletion/';
const root = $('acct-del');

const TEXT = {
  deletionFailed:
    "Something went wrong, and your account may already be closed. Don't try again: check your email for the cancel link. " +
    'If no email comes within an hour, write to support@vettid.org.',
  codeNotSent: "We couldn't send the code. Nothing has changed. Try again in a few minutes, or write to support@vettid.org.",
  tooMany: 'Too many tries. Wait a few minutes and try again.',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The first daily run (07:00 UTC) at or after `deletes_at`, as "10 November 2026, 07:00 UTC" (the emails' wording). */
function deletionWhen(iso) {
  const d = new Date(iso);
  const run = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 7, 0, 0));
  if (run.getTime() < d.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return `${run.getUTCDate()} ${MONTHS[run.getUTCMonth()]} ${run.getUTCFullYear()}, 07:00 UTC`;
}

function sectionHead(id, title) {
  return el('header', { class: 'sec-head' }, el('h2', { id, tabindex: '-1' }, title));
}

const card = (...children) => el('section', { class: 'card', 'aria-labelledby': 'h-acct-del' }, children);
const backToAccount = () => el('a', { class: 'btn', href: '/account/#settings' }, 'Back to your account');

async function load() {
  let state;
  try {
    state = await get('/api/account/deletion', { redirect: false });
  } catch (err) {
    if (err?.status === 401) renderSignedOut();
    else renderLoadError(err);
    return;
  }
  if (state.blocked_by?.vaults?.length) renderBlocked(state.blocked_by.vaults);
  else renderForm(state);
  $('h-acct-del')?.focus();
}

function renderSignedOut() {
  fill(root, card(
    sectionHead('h-acct-del', 'Delete your VettID account.'),
    el('p', {}, 'Sign in first, then choose Delete my account on your account page.'),
    el('div', { class: 'actions' }, el('a', { class: 'btn btn-primary', href: '/signin/' }, 'Sign in')),
  ));
}

function renderLoadError(err) {
  fill(root, card(
    sectionHead('h-acct-del', 'Delete your VettID account.'),
    el('p', {}, "We couldn't load this page. ", err?.status === 429 ? TEXT.tooMany : ui.errorText(err)),
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn btn-primary', on: { click: load } }, 'Try again'), backToAccount()),
  ));
}

/** A vault blocks the deletion: an unfinished setup (every blocking vault `enrolling`), or a vault. */
function renderBlocked(vaults) {
  if (vaults.every((v) => v.state === 'enrolling')) {
    fill(root, card(
      sectionHead('h-acct-del', "Your vault setup isn't finished."),
      el('p', {}, 'Your VettID account can be deleted only when no vault is left. Finish setting up your vault in the VettID app and then delete it there, or write to ',
        el('a', { href: 'mailto:support@vettid.org' }, 'support@vettid.org'), ' to end the setup.'),
      el('div', { class: 'actions' }, backToAccount()),
    ));
    return;
  }
  fill(root, card(
    sectionHead('h-acct-del', 'You still have a vault.'),
    el('p', {}, 'Your VettID account can be deleted only after your vault. Delete your vault in the VettID app, or here with ',
      el('a', { href: START_OVER }, el('strong', {}, 'Delete my vault and start over')), ', which takes 24 hours. Then come back to this page.'),
    el('div', { class: 'actions' }, el('a', { class: 'btn btn-danger', href: START_OVER }, 'Delete my vault and start over'), backToAccount()),
  ));
}

function renderForm(state) {
  const list = state.mailing_list ? el('input', { type: 'checkbox', checked: true }) : null;
  const typed = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: 32 });
  const pin = state.pin_required ? ui.pinInput({ name: 'pin' }) : null;
  const code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: 6, spellcheck: 'false' });
  const askCode = el('button', { type: 'button', class: 'btn' }, 'Email me a code');
  const submit = el('button', { type: 'submit', class: 'btn btn-danger-solid' }, 'Delete my account');

  askCode.addEventListener('click', async () => {
    const res = await ui.busy(askCode, () => post('/api/account/deletion/code', undefined, { redirect: false }), {
      busyLabel: 'Sending…',
      onError: (err) => {
        if (err?.code === 'vault_exists') return void load();
        if (err?.status === 429) return ui.showError(err.message || TEXT.tooMany);
        if (err?.status >= 500) return ui.showError(TEXT.codeNotSent);
        ui.showError(err);
      },
    });
    if (res) {
      ui.showNotice("We've emailed you a code. It works for 15 minutes.");
      code.focus();
    }
  });

  const form = el('form', { class: 'form-grid', novalidate: true },
    list ? ui.checkRow(list, 'Also remove me from the VettID mailing list') : null,
    ui.field('Type delete my account to confirm', typed, { hint: 'Exactly these three words, in lower case.' }),
    pin ? ui.field('Your PIN', pin, { hint: 'Because your account has a PIN, we need it to confirm.' }) : null,
    el('div', { class: 'actions' }, askCode),
    ui.field('The code from the email', code, { hint: '6 digits.' }),
    el('div', { class: 'actions' }, submit, backToAccount()),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (typed.value !== PHRASE) {
      ui.fieldError(typed, 'Type delete my account exactly as shown.');
      typed.focus();
      return;
    }
    ui.fieldError(typed, '');
    const body = { confirm: PHRASE, code: code.value.trim(), remove_from_mailing_list: list ? list.checked : false };
    if (pin) {
      const p = ui.checkPin(pin);
      if (!p) {
        pin.focus();
        return;
      }
      body.pin = p;
    }
    if (!/^\d{6}$/.test(body.code)) {
      ui.fieldError(code, 'Enter the 6-digit code from the email.');
      code.focus();
      return;
    }
    ui.fieldError(code, '');
    const res = await ui.busy(form, () => post('/api/account/deletion', body, { redirect: false }), {
      busyLabel: 'Deleting…',
      onError: (err) => {
        if (err?.code === 'vault_exists') return void load();
        if (err?.status === 429) return ui.showError(err.message || TEXT.tooMany);
        // A 500 may come after the account was closed: never invite a retry.
        if (err?.status >= 500 || err?.status === 0) return renderFailed();
        ui.showError(err); // the phrase, the PIN and the code: the API's texts
      },
    });
    if (res) renderDone(res);
  });

  fill(root, card(
    sectionHead('h-acct-del', 'Delete your VettID account.'),
    el('p', {}, 'This deletes your membership, your sign-in, your subscription and your email address from VettID (unless you stay on the mailing list). ' +
      "Your account is closed at once and deleted after 7 days. Until then you can cancel with the link we email you. After that it can't be undone. " +
      'A record that your account existed stays in our security log. Any copy of your email address in our logs is deleted within 90 days, and in AWS\'s own audit log within 400 days.'),
    form,
  ));
}

function renderDone(res) {
  fill(root, card(
    sectionHead('h-acct-del', 'Your account is closed.'),
    el('p', {}, `It will be deleted after ${deletionWhen(res.deletes_at)}. We're emailing you a link that cancels the deletion.`),
  ));
  $('h-acct-del')?.focus();
}

function renderFailed() {
  fill(root, card(
    sectionHead('h-acct-del', 'Something went wrong'),
    el('p', {}, TEXT.deletionFailed),
  ));
  $('h-acct-del')?.focus();
}

load();
