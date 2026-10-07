// Account dashboard. Bootstraps from GET /api/account/me (the API wrapper
// handles 401 -> refresh -> retry -> /signin/). Every mutating call returns a
// fresh `Me`, which re-renders the dashboard.

import { del, get, post, publicPost } from './api.js';
import { $, chip, date, el, fill } from './dom.js';
import * as ui from './ui.js';
import { mountVault, renderVault, showVault } from './vault.js';

ui.init();
mountVault({ getMe: () => me, reveal: (id) => reveal(id) });

const TERMS_URL_MAX_AGE_MS = 4 * 60 * 1000; // pdf_url is presigned for 5 minutes

let me = null;

// Terms text cache: { data, fetchedAt } | null, plus a load state.
let terms = null;
let termsState = 'idle'; // idle | loading | error
let termsOpen = false; // "View terms" panel for already-accepted members

// Subscription types cache (reset whenever `me` changes).
let subTypes = null;
let subTypesState = 'idle';

// Which inline form is open.
let pinMode = null; // null | 'enable' | 'change' | 'disable'
let cancelOpen = false;

// ── Boot ────────────────────────────────────────────────────────────────

async function boot() {
  const gateMsg = $('gate-msg');
  fill(gateMsg, 'Loading your account…');
  try {
    me = await get('/api/account/me');
  } catch (err) {
    fill($('gate'),
      el('p', { id: 'gate-msg' }, "We couldn't load your account. ", ui.errorText(err)),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn btn-primary', on: { click: () => location.reload() } }, 'Try again')),
    );
    return;
  }
  $('gate').hidden = true;
  $('dash').hidden = false;
  renderAll();
  selectTab(tabFromHash(), { focus: false });
}

/** Accept a fresh Me from the API, re-render, and put focus somewhere sensible. */
function setMe(next, { focus, notice } = {}) {
  if (!next || typeof next !== 'object' || !next.user_guid) {
    // Defensive: refetch if a call didn't hand back a Me.
    return get('/api/account/me').then((m) => setMe(m, { focus, notice }));
  }
  me = next;
  subTypes = null;
  subTypesState = 'idle';
  renderAll();
  if (notice) ui.showNotice(notice);
  if (focus) reveal(focus);
  return undefined;
}

/** Focus an element by id, switching to the tab that contains it. */
function reveal(id) {
  const node = $(id);
  if (!node) return;
  const panel = node.closest('[role="tabpanel"]');
  if (panel?.hidden) selectTab(panel.id.replace('panel-', ''), { focus: false });
  node.focus();
}

function renderAll() {
  renderHeader();
  renderTabs();
  renderChecklist();
  renderStatus();
  renderTerms();
  renderSubscription();
  renderPin();
  renderPrefs();
  renderCancel();
  renderVault();
}

// ── Shared bits ─────────────────────────────────────────────────────────

const fullName = () => [me.first_name, me.last_name].filter(Boolean).join(' ');

function sectionHead(id, title, intro) {
  return el('header', { class: 'sec-head' },
    el('h2', { id, tabindex: '-1' }, title),
    intro ? el('p', {}, intro) : null,
  );
}

function facts(rows) {
  return el('dl', { class: 'facts' }, rows.filter(Boolean).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

const SUB_STATUS = {
  trial: ['Free trial', 'ok'],
  active: ['Active', 'ok'],
  expired: ['Expired', 'mute'],
  canceled: ['Canceled', 'warn'],
};

function subChip(status) {
  const [label, tone] = SUB_STATUS[status] ?? [status, 'mute'];
  return chip(label, tone);
}

const subIsLive = (s) => !!s && (s.status === 'trial' || s.status === 'active');

function days(n) {
  const d = Number(n);
  if (!Number.isFinite(d) || d <= 0) return '';
  if (d % 365 === 0) return d === 365 ? '1 year' : `${d / 365} years`;
  return `${d} day${d === 1 ? '' : 's'}`;
}

const shortHash = (h) => (h ? `${String(h).slice(0, 12)}…` : '');

// ── Tabs (#start | #membership | #vault | #security | #settings) ────────
// The first tab is labelled "Getting started" while actionable steps remain
// and "Overview" once they're done; its hash stays #start (#overview is an
// alias kept for old links).

const TABS = ['start', 'membership', 'vault', 'security', 'settings'];
const HASH_ALIASES = { overview: 'start' };

function tabFromHash() {
  const raw = location.hash.replace(/^#/, '');
  const h = HASH_ALIASES[raw] ?? raw;
  return TABS.includes(h) ? h : 'start';
}

/** Badge + label on the first tab, from the checklist's pending count. */
function renderTabs() {
  const left = pendingSteps().length;
  const label = left ? 'Getting started' : 'Overview';
  $('tab-start-label').textContent = label;
  const badge = $('tab-start-badge');
  badge.textContent = left ? String(left) : '';
  badge.hidden = !left;
  $('tab-start').setAttribute('aria-label', left ? `${label}, ${left} step${left === 1 ? '' : 's'} left` : label);
}

function selectTab(name, { focus = true } = {}) {
  for (const t of TABS) {
    const on = t === name;
    const tab = $(`tab-${t}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
  const want = `#${name}`;
  if (location.hash !== want) history.replaceState(null, '', location.pathname + location.search + want);
  if (name === 'vault') showVault();
  if (focus) $(`tab-${name}`).focus();
}

for (const t of TABS) {
  $(`tab-${t}`).addEventListener('click', () => selectTab(t));
}
$('tabs').addEventListener('keydown', (e) => {
  const i = TABS.indexOf(tabFromHash());
  let next = null;
  if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
  else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
  else if (e.key === 'Home') next = TABS[0];
  else if (e.key === 'End') next = TABS[TABS.length - 1];
  if (!next) return;
  e.preventDefault();
  selectTab(next);
});
window.addEventListener('hashchange', () => {
  if (me) selectTab(tabFromHash(), { focus: false });
});

// ── Header ──────────────────────────────────────────────────────────────

function renderHeader() {
  $('who-name').textContent = fullName();
  $('who-email').textContent = me.email;
  $('who').hidden = false;
  $('signout').hidden = false;
  $('hello').textContent = me.first_name ? `Hi, ${me.first_name}` : 'Your account';
}

$('signout').addEventListener('click', (e) => {
  ui.busy(e.currentTarget, async () => {
    try {
      await publicPost('/api/auth/signout');
    } catch (err) {
      // Already signed out is fine; only a network failure should stop us.
      if (err.status === 0) throw err;
    }
    location.replace('/signin/?signedout=1');
  }, { busyLabel: 'Signing out…' });
});

// ── Overview: getting-started checklist ─────────────────────────────────

let showSteps = false; // expand the checklist after "You're all set"

function goPin() {
  if (!me.pin_enabled) pinMode = 'enable';
  renderPin();
  reveal('h-pin');
  $('sec-pin').querySelector('form input')?.focus();
}

function steps() {
  const member = me.state === 'member';
  const tm = me.terms ?? {};
  const termsDone = !!tm.current_version && !tm.needs_acceptance && !!tm.accepted_version;
  const pinSkipped = !me.pin_enabled && !!me.preferences?.pin_prompt_dismissed;
  const btn = (label, fn, primary = true) => el('button', { type: 'button', class: `btn btn-sm ${primary ? 'btn-primary' : ''}`.trim(), on: { click: fn } }, label);

  return [
    {
      key: 'email',
      title: 'Verify your email',
      done: me.email_verified !== false,
      text: 'Done — you signed in with the link we emailed you.',
      actionable: true,
    },
    {
      key: 'pin',
      title: 'Protect your sign-in with a PIN',
      badge: 'Recommended',
      done: !!me.pin_enabled,
      skipped: pinSkipped,
      text: me.pin_enabled
        ? 'Your PIN is on.'
        : "With a PIN, someone who gets into your email still can't get into VettID.",
      actionable: true,
      actions: me.pin_enabled
        ? null
        : pinSkipped
          ? [btn('Set one up anyway', goPin, false)]
          : [btn('Set up a PIN', goPin), el('button', { type: 'button', class: 'link-btn', on: { click: skipPin } }, 'Skip for now')],
    },
    {
      key: 'terms',
      title: 'Accept the membership terms',
      done: termsDone,
      text: termsDone
        ? `You accepted version ${tm.accepted_version}.`
        : !tm.current_version
          ? "The terms aren't published yet. We'll ask you to accept them here once they are."
          : member
            ? 'The terms have been updated. Please review the new version.'
            : 'Read and accept the terms to become a member.',
      actionable: !!tm.current_version,
      actions: !termsDone && tm.current_version ? [btn('Review the terms', () => reveal('h-terms'))] : null,
    },
    {
      key: 'trial',
      title: 'Start your free trial',
      done: !!me.subscription,
      text: me.subscription
        ? `${me.subscription.type_name}: ${(SUB_STATUS[me.subscription.status] ?? [me.subscription.status])[0].toLowerCase()}.`
        : member
          ? 'Try VettID free. Nothing to pay.'
          : 'Available once you accept the membership terms.',
      actionable: member,
      actions: !me.subscription && member ? [btn('Choose your trial', () => reveal('h-sub'))] : null,
    },
    {
      key: 'vote',
      title: 'Voting rights',
      done: !!me.voting_rights,
      text: me.voting_rights ? 'You can vote.' : 'Needs an active paid subscription. Payments coming soon.',
      actionable: false,
    },
  ];
}

/** Actionable steps not yet done or skipped (voting never counts). */
function pendingSteps() {
  return steps().filter((s) => s.actionable && !s.done && !s.skipped);
}

async function skipPin(e) {
  const next = await ui.busy(e.currentTarget, () => post('/api/account/preferences', { pin_prompt_dismissed: true }));
  if (next) await setMe(next, { focus: 'h-checklist', notice: 'Skipped for now. You can set up a PIN any time under Security.' });
}

// Only the current step gets the gold primary button.
function secondary(node) {
  node.classList?.remove('btn-primary');
  return node;
}

function renderChecklist() {
  const sec = $('sec-checklist');
  const list = steps();
  const doneCount = list.filter((s) => s.done).length;
  const current = list.find((s) => s.actionable && !s.done && !s.skipped && s.actions);
  const allSet = pendingSteps().length === 0;

  const progress = el('div', { class: 'progress' },
    el('span', { class: 'progress-bar', 'aria-hidden': 'true' }, list.map((s) => el('span', { class: s.done ? 'on' : null }))),
    el('span', {}, `${doneCount} of ${list.length} done`),
  );

  const head = sectionHead('h-checklist', 'Getting started');

  if (allSet && !showSteps) {
    fill(sec, head,
      el('div', { class: 'all-set' },
        el('span', { class: 'all-set-text' }, el('span', { class: 'step-mark', 'aria-hidden': 'true' }, '✓'), el('p', {}, me.state === 'member' ? "You're all set." : "Nothing to do right now. We'll let you know when the membership terms are ready.")),
        el('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false', on: { click: () => { showSteps = true; renderChecklist(); $('steps-toggle')?.focus(); } }, id: 'steps-toggle' }, 'Show steps'),
      ),
    );
    return;
  }

  const items = list.map((s, i) => {
    const state = s.done ? 'done' : s.skipped ? 'skipped' : s === current ? 'current' : 'todo';
    const stateText = { done: 'Done', skipped: 'Skipped', current: 'Next step', todo: s.actionable ? 'To do' : 'Not available yet' }[state];
    return el('li', { class: `step is-${state}`, 'aria-current': s === current ? 'step' : null },
      el('span', { class: 'step-mark', 'aria-hidden': 'true' }, s.done ? '✓' : s.skipped ? '–' : String(i + 1)),
      el('div', {},
        el('h3', {}, s.title, s.badge && !s.done ? chip(s.badge, 'accent') : null,
          el('span', { class: 'step-state' }, `· ${stateText}`)),
        el('p', {}, s.text),
        s.actions ? el('div', { class: 'actions' }, s === current ? s.actions : s.actions.map(secondary)) : null,
      ),
    );
  });

  fill(sec, head, progress, el('ol', { class: 'checklist' }, items),
    allSet
      ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'link-btn', id: 'steps-toggle', 'aria-expanded': 'true', on: { click: () => { showSteps = false; renderChecklist(); $('steps-toggle')?.focus(); } } }, 'Hide steps'))
      : null,
  );
}

// ── Overview: status summary ────────────────────────────────────────────

function renderStatus() {
  const member = me.state === 'member';
  const sub = me.subscription;

  let subSummary;
  if (!sub) {
    subSummary = el('span', {}, 'None');
  } else {
    const ends = subIsLive(sub) ? 'Ends ' : 'Ended ';
    subSummary = el('span', {},
      sub.type_name, ' ', subChip(sub.status),
      el('span', { class: 'muted' }, sub.paid ? 'Paid' : 'Free', ' · ', ends, date(sub.expires_at)),
    );
  }

  const voting = me.voting_rights
    ? el('span', {}, chip('Yes', 'ok'))
    : el('span', {}, chip('Not yet', 'mute'), el('span', { class: 'muted' }, 'Voting requires an active paid subscription.'));

  // MEMBER-API 2.2.0: read-only here; names change only in the app, through the vault.
  const name = el('span', {},
    fullName() || '—',
    el('span', { class: 'muted' }, 'Every connection of your vault sees this name. You can change it in the VettID app, at most once every 30 days.'),
  );

  fill($('sec-status'),
    sectionHead('h-status', 'Status'),
    facts([
      ['Name', name],
      ['Membership', member ? chip('Member', 'ok') : chip('Registered', 'warn')],
      ['Subscription', subSummary],
      ['Voting rights', voting],
      ['Email', me.email],
      ['Joined', date(me.created_at)],
    ]),
  );
}

// ── 2. Membership terms ─────────────────────────────────────────────────

async function loadTerms() {
  // Re-rendering replaces the section's nodes; keep focus where it was.
  const refocus = document.activeElement?.id;
  termsState = 'loading';
  renderTerms();
  try {
    terms = { data: await get('/api/account/terms'), fetchedAt: Date.now() };
    termsState = 'idle';
  } catch (err) {
    termsState = 'error';
    ui.showError(err);
  }
  renderTerms();
  if (refocus && !document.activeElement?.id) $(refocus)?.focus();
}

function termsParagraphs(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => el('p', {}, p));
}

function pdfLink(t) {
  if (!t.pdf_url) return null;
  const a = el('a', { class: 'btn btn-sm', href: t.pdf_url, target: '_blank', rel: 'noopener noreferrer' }, 'Download PDF');
  a.addEventListener('click', async (e) => {
    if (Date.now() - terms.fetchedAt < TERMS_URL_MAX_AGE_MS) return;
    // The presigned link has (nearly) expired; fetch a fresh one first.
    e.preventDefault();
    await ui.busy(a.closest('section'), async () => {
      terms = { data: await get('/api/account/terms'), fetchedAt: Date.now() };
      renderTerms();
      ui.showNotice('The download link was refreshed. Select Download PDF again.', 'info');
    });
  });
  return a;
}

function termsPanel(t) {
  return el('div', { class: 'terms-text', tabindex: '0', role: 'region', 'aria-label': `${t.title || 'Membership terms'} — full text` },
    termsParagraphs(t.text));
}

function renderTerms() {
  const sec = $('sec-terms');
  const tm = me.terms ?? {};

  if (!tm.current_version) {
    fill(sec,
      sectionHead('h-terms', 'Membership terms'),
      el('p', {}, "There are no membership terms to review yet. We'll ask you to read and accept them here once they're published."),
    );
    return;
  }

  const needLoad = tm.needs_acceptance || termsOpen;
  if (needLoad && !terms && termsState === 'idle') {
    loadTerms();
    return;
  }

  if (!tm.needs_acceptance) {
    const toggle = el('button', { type: 'button', class: 'btn btn-sm', 'aria-expanded': String(termsOpen) },
      termsOpen ? 'Hide terms' : 'View terms');
    toggle.addEventListener('click', () => {
      termsOpen = !termsOpen;
      renderTerms();
      $('terms-toggle')?.focus();
    });
    toggle.id = 'terms-toggle';
    const body = [];
    if (termsOpen) {
      if (termsState === 'loading') body.push(el('p', { class: 'loading' }, 'Loading terms…'));
      else if (terms) body.push(el('h3', {}, terms.data.title || 'Membership terms'), termsPanel(terms.data));
    }
    fill(sec,
      sectionHead('h-terms', 'Membership terms'),
      el('p', {}, chip('Accepted', 'ok'), ' ', `You accepted version ${tm.accepted_version}, the current version.`),
      body,
      el('div', { class: 'actions' }, toggle, termsOpen && terms ? pdfLink(terms.data) : null),
    );
    return;
  }

  // Needs acceptance.
  const member = me.state === 'member';
  const intro = member
    ? 'The membership terms have changed since you last accepted them. Please read the new version.'
    : 'Please read the membership terms. Accepting them makes you a VettID member.';

  if (termsState === 'loading' || !terms) {
    fill(sec,
      sectionHead('h-terms', 'Membership terms', intro),
      termsState === 'error'
        ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', on: { click: loadTerms } }, 'Try loading the terms again'))
        : el('p', { class: 'loading' }, 'Loading terms…'),
    );
    return;
  }

  const t = terms.data;
  const box = el('input', { type: 'checkbox', id: 'terms-agree' });
  const accept = el('button', { type: 'submit', class: 'btn btn-primary', disabled: true }, 'Accept terms');
  box.addEventListener('change', () => {
    accept.disabled = !box.checked;
  });
  const form = el('form', {},
    ui.checkRow(box, [
      `I have read and accept these terms (version ${t.version_id}, SHA-256 `,
      el('code', { class: 'hash', title: t.sha256 }, shortHash(t.sha256)),
      ')',
    ]),
    el('div', { class: 'actions' }, accept, pdfLink(t)),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!box.checked) return;
    const wasMember = me.state === 'member';
    const next = await ui.busy(form, () => post('/api/account/terms/accept', { version_id: t.version_id, sha256: t.sha256 }), {
      busyLabel: 'Saving…',
      onError: (err) => {
        if (err.status === 409 || err.code === 'conflict') {
          ui.showError('The terms were updated a moment ago. Please review the latest version.');
          terms = null;
          termsState = 'idle';
          get('/api/account/me').then((m) => setMe(m, { focus: 'h-terms' }));
        } else {
          ui.showError(err);
        }
      },
    });
    if (!next) return;
    terms = null;
    termsOpen = false;
    await setMe(next, {
      focus: wasMember ? 'h-terms' : 'h-sub',
      notice: wasMember
        ? 'Thank you — you have accepted the updated terms.'
        : "Thank you — you're now a VettID member. Next: start your free trial below.",
    });
  });

  fill(sec,
    sectionHead('h-terms', 'Membership terms', intro),
    el('h3', {}, t.title || 'Membership terms'),
    termsPanel(t),
    form,
  );
}

// ── 3. Subscription (members only) ──────────────────────────────────────

async function loadSubTypes() {
  subTypesState = 'loading';
  try {
    const res = await get('/api/account/subscription-types');
    subTypes = Array.isArray(res?.items) ? res.items : [];
    subTypesState = 'idle';
  } catch (err) {
    subTypesState = 'error';
    ui.showError(err);
  }
  // Re-rendering replaces the section's nodes; keep focus where it was.
  const refocus = document.activeElement?.id;
  renderSubscription();
  if (refocus && !document.activeElement?.id) $(refocus)?.focus();
}

function renderSubscription() {
  const sec = $('sec-sub');
  if (me.state !== 'member') {
    fill(sec,
      sectionHead('h-sub', 'Subscription'),
      el('p', {}, "Subscriptions open up once you've accepted the membership terms above."),
    );
    return;
  }
  const sub = me.subscription;

  if (subIsLive(sub)) {
    const cancel = el('button', { type: 'button', class: 'btn btn-danger' }, 'Cancel subscription');
    cancel.addEventListener('click', async () => {
      const ok = await ui.confirm({
        title: 'Cancel your subscription?',
        body: [
          `Your ${sub.type_name} subscription will be canceled.`,
          sub.status === 'trial' ? "Free trials can only be used once, so you won't be able to start this trial again." : null,
        ].filter(Boolean),
        confirmLabel: 'Cancel subscription',
        cancelLabel: 'Keep it',
        tone: 'danger',
      });
      if (!ok) return;
      const next = await ui.busy(cancel, () => post('/api/account/subscription/cancel'), { busyLabel: 'Canceling…' });
      if (next) await setMe(next, { focus: 'h-sub', notice: 'Your subscription has been canceled.' });
    });
    fill(sec,
      sectionHead('h-sub', 'Subscription'),
      facts([
        ['Plan', sub.type_name],
        ['Status', subChip(sub.status)],
        ['Type', sub.paid ? 'Paid' : 'Free'],
        ['Started', date(sub.started_at)],
        ['Ends', date(sub.expires_at)],
      ]),
      !sub.paid ? el('p', { class: 'next-step note' }, 'Free subscriptions do not include voting rights. Voting requires an active paid subscription.') : null,
      el('div', { class: 'actions' }, cancel),
    );
    return;
  }

  // No live subscription: show what they had (if anything) and the chooser.
  if (!subTypes && subTypesState === 'idle') {
    loadSubTypes();
  }
  const past = sub
    ? el('p', { class: 'muted' }, `Your ${sub.type_name} subscription `, sub.status === 'canceled' ? 'was canceled' : 'has ended',
      '. It ran until ', date(sub.expires_at), '.')
    : null;

  let chooser;
  if (subTypesState === 'error') {
    chooser = el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', on: { click: loadSubTypes } }, 'Try loading subscriptions again'));
  } else if (!subTypes) {
    chooser = el('p', { class: 'loading' }, 'Loading subscriptions…');
  } else if (subTypes.length === 0) {
    chooser = el('p', {}, "There are no subscriptions you can start right now. Paid subscriptions are coming soon — we'll let you know.");
  } else {
    chooser = el('div', { class: 'plans' }, subTypes.map(planCard));
  }

  fill(sec,
    sectionHead('h-sub', 'Subscription', 'Choose a subscription. Paid subscriptions, which come with voting rights, are coming soon.'),
    past,
    chooser,
  );
}

function planCard(t) {
  const meta = [t.is_trial ? 'Free trial' : t.paid ? 'Paid' : 'Free', days(t.duration_days)].filter(Boolean).join(' · ');
  let action;
  if (t.is_trial) {
    action = el('button', { type: 'button', class: 'btn btn-primary' }, 'Start free trial');
    action.addEventListener('click', async () => {
      const ok = await ui.confirm({
        title: `Start your ${t.name}?`,
        body: [
          `This is free${t.duration_days ? ` and lasts ${days(t.duration_days)}` : ''}. Nothing to pay.`,
          'You can use a free trial only once.',
        ],
        confirmLabel: 'Start free trial',
      });
      if (!ok) return;
      const next = await ui.busy(action, () => post('/api/account/subscription', { type_id: t.type_id }), { busyLabel: 'Starting…' });
      if (next) await setMe(next, { focus: 'h-sub', notice: `Your ${t.name} has started.` });
    });
  } else {
    const noteId = ui.uid('pay');
    action = el('div', { class: 'plan-action' },
      el('button', { type: 'button', class: 'btn', disabled: true, 'aria-describedby': noteId }, 'Subscribe'),
      el('span', { class: 'hint', id: noteId }, 'Payments coming soon'),
    );
  }
  return el('div', { class: 'plan' },
    el('div', {},
      el('h3', {}, t.name, t.paid ? chip('Includes voting', 'mute') : null),
      t.description ? el('p', {}, t.description) : null,
      meta ? el('p', { class: 'plan-meta' }, meta) : null,
    ),
    t.is_trial ? el('div', { class: 'plan-action' }, action) : action,
  );
}

// ── 4. Security — PIN ───────────────────────────────────────────────────

function renderPin() {
  const sec = $('sec-pin');
  const on = !!me.pin_enabled;

  const openMode = (mode) => () => {
    pinMode = mode;
    renderPin();
    sec.querySelector('form input')?.focus();
  };

  const buttons = on
    ? [
      el('button', { type: 'button', class: 'btn', on: { click: openMode('change') }, 'aria-expanded': String(pinMode === 'change') }, 'Change PIN'),
      el('button', { type: 'button', class: 'btn btn-danger', on: { click: openMode('disable') }, 'aria-expanded': String(pinMode === 'disable') }, 'Turn off PIN'),
    ]
    : [el('button', { type: 'button', class: 'btn btn-primary', on: { click: openMode('enable') }, 'aria-expanded': String(pinMode === 'enable') }, 'Set up a PIN')];

  fill(sec,
    sectionHead('h-pin', 'Sign-in PIN',
      "A PIN is an optional second step. After you click the sign-in link we email you, we'll also ask for your PIN — so someone who gets into your email still can't get into your VettID account."),
    el('p', { class: 'muted' }, 'How signing in works: we email you a one-time link. If you have a PIN, we ask for it after you click the link.'),
    el('p', {}, on ? chip('PIN on', 'ok') : chip('PIN off', 'mute'), ' ',
      on ? "You'll be asked for your PIN each time you sign in." : 'Signing in only needs the email link.'),
    pinMode ? null : el('div', { class: 'actions' }, buttons),
    pinMode ? pinForm(pinMode) : null,
  );
}

function pinForm(mode) {
  const current = mode === 'enable' ? null : ui.pinInput({ name: 'current_pin' });
  const next = mode === 'disable' ? null : ui.pinInput({ name: 'pin' });
  const again = mode === 'disable' ? null : ui.pinInput({ name: 'pin_confirm' });
  const labels = {
    enable: ['Set up a PIN', 'Turn on PIN'],
    change: ['Change your PIN', 'Save new PIN'],
    disable: ['Turn off your PIN', 'Turn off PIN'],
  }[mode];

  const submit = el('button', { type: 'submit', class: mode === 'disable' ? 'btn btn-danger-solid' : 'btn btn-primary' }, labels[1]);
  const close = el('button', { type: 'button', class: 'btn' }, 'Cancel');
  close.addEventListener('click', () => {
    pinMode = null;
    renderPin();
    $('h-pin').focus();
  });

  const form = el('form', { class: 'subform form-grid', novalidate: true },
    el('h3', {}, labels[0]),
    current ? ui.field('Current PIN', current) : null,
    next ? ui.field(mode === 'change' ? 'New PIN' : 'PIN', next, { hint: '4 to 8 digits. Avoid easy ones like 1234, 1111, or your birth year.' }) : null,
    again ? ui.field(mode === 'change' ? 'Type the new PIN again' : 'Type the PIN again', again) : null,
    el('div', { class: 'actions' }, submit, close),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = [current, next, again].filter(Boolean);
    for (const i of inputs) ui.fieldError(i, '');
    const cur = current ? ui.checkPin(current, 'current PIN') : '';
    const pin = next ? ui.checkPin(next) : '';
    if (cur === null || pin === null) {
      inputs.find((i) => i.getAttribute('aria-invalid') === 'true')?.focus();
      return;
    }
    if (again && again.value.trim() !== pin) {
      ui.fieldError(again, "The two PINs don't match.");
      again.focus();
      return;
    }

    let call;
    let notice;
    if (mode === 'enable') {
      call = () => post('/api/account/pin', { pin });
      notice = "Your PIN is on. You'll be asked for it each time you sign in.";
    } else if (mode === 'change') {
      if (pin === cur) {
        ui.fieldError(next, 'Your new PIN must be different from your current one.');
        next.focus();
        return;
      }
      call = () => post('/api/account/pin', { pin, current_pin: cur });
      notice = 'Your PIN has been changed.';
    } else {
      call = () => del('/api/account/pin', { current_pin: cur });
      notice = 'Your PIN is off. Signing in now only needs the email link.';
    }

    const res = await ui.busy(form, call, {
      busyLabel: 'Saving…',
      onError: (err) => {
        ui.showError(err);
        (current ?? next)?.focus();
      },
    });
    if (!res) return;
    pinMode = null;
    await setMe(res, { focus: 'h-pin', notice });
  });

  return form;
}

// ── 5. Email preferences ────────────────────────────────────────────────

function renderPrefs() {
  const sec = $('sec-prefs');
  const box = el('input', { type: 'checkbox', id: 'pref-updates', role: 'switch', checked: !!me.preferences?.email_updates, 'aria-describedby': 'pref-updates-hint' });
  box.addEventListener('change', async () => {
    const want = box.checked;
    box.disabled = true;
    const res = await ui.busy(sec, () => post('/api/account/preferences', { email_updates: want }), {
      onError: (err) => {
        box.checked = !want;
        ui.showError(err);
      },
    });
    box.disabled = false;
    if (res) {
      await setMe(res, {
        focus: 'pref-updates',
        notice: want ? "You'll get VettID news and updates by email." : "You won't get VettID news and updates by email.",
      });
    } else {
      box.focus();
    }
  });
  fill(sec,
    sectionHead('h-prefs', 'Email preferences'),
    el('div', { class: 'toggle' },
      el('div', {},
        el('label', { for: 'pref-updates' }, 'Email me VettID news and updates'),
        el('p', { class: 'hint', id: 'pref-updates-hint' }, 'Sign-in links are always sent, whatever you choose here.'),
      ),
      box,
    ),
  );
}

// ── 6. Cancel account ───────────────────────────────────────────────────

function renderCancel() {
  const sec = $('sec-cancel');
  const head = [
    sectionHead('h-cancel', 'Cancel your account'),
    el('p', {}, "If you cancel, your account is switched off right away and you'll be signed out."),
    el('ul', {},
      el('li', {}, 'Your account and personal information are permanently deleted after 7 days.'),
      el('li', {}, 'Changed your mind? Email ', el('a', { href: 'mailto:support@vettid.org' }, 'support@vettid.org'), ' within those 7 days and we can restore it.'),
      el('li', {}, "After 7 days, it can't be undone."),
    ),
  ];

  if (!cancelOpen) {
    const open = el('button', { type: 'button', class: 'btn btn-danger', 'aria-expanded': 'false' }, 'Cancel my account…');
    open.addEventListener('click', () => {
      cancelOpen = true;
      renderCancel();
      $('cancel-confirm')?.focus();
    });
    fill(sec, head, el('div', { class: 'actions' }, open));
    return;
  }

  const typed = el('input', { type: 'text', id: 'cancel-confirm', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 16 });
  const pin = me.pin_enabled ? ui.pinInput({ name: 'pin' }) : null;
  const submit = el('button', { type: 'submit', class: 'btn btn-danger-solid', disabled: true }, 'Cancel my account');
  const keep = el('button', { type: 'button', class: 'btn' }, 'Keep my account');
  keep.addEventListener('click', () => {
    cancelOpen = false;
    renderCancel();
    $('h-cancel').focus();
  });
  typed.addEventListener('input', () => {
    submit.disabled = typed.value.trim() !== 'CANCEL';
  });

  const form = el('form', { class: 'subform form-grid', novalidate: true },
    el('h3', {}, 'Are you sure?'),
    ui.field('Type CANCEL to confirm', typed, { hint: 'In capital letters.' }),
    pin ? ui.field('Your PIN', pin, { hint: 'Because your account has a PIN, we need it to confirm.' }) : null,
    el('div', { class: 'actions' }, submit, keep),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (typed.value.trim() !== 'CANCEL') {
      ui.fieldError(typed, 'Type CANCEL (in capital letters) to confirm.');
      typed.focus();
      return;
    }
    ui.fieldError(typed, '');
    const body = { confirm: 'CANCEL' };
    if (pin) {
      const p = ui.checkPin(pin);
      if (!p) {
        pin.focus();
        return;
      }
      body.pin = p;
    }
    const res = await ui.busy(form, () => post('/api/account/cancel', body), { busyLabel: 'Canceling…' });
    if (res) location.replace('/signin/?canceled=1');
  });

  fill(sec, head, form);
}

boot();
