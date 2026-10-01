// Bootstrap: load /config.json, sign in, then route between sections by #hash.

import * as auth from './auth.js';
import * as api from './api.js';
import * as ui from './ui.js';
import * as requests from './sections/requests.js';
import * as members from './sections/members.js';
import * as invites from './sections/invites.js';
import * as terms from './sections/terms.js';
import * as subscriptionTypes from './sections/subscription-types.js';
import * as admins from './sections/admins.js';
import * as audit from './sections/audit.js';

const ROUTES = {
  requests: [requests],
  members: [members],
  invites: [invites],
  terms: [terms],
  'subscription-types': [subscriptionTypes],
  admins: [admins, audit],
};
const DEFAULT_ROUTE = 'requests';
const CONFIG_KEYS = ['apiBase', 'cognitoDomain', 'clientId', 'redirectUri'];

const $ = (id) => document.getElementById(id);

function setWho(email) {
  $('who').textContent = email;
  $('who').title = email; // full value when the header truncates it
}

function showGate(message, canSignIn) {
  $('shell').hidden = true;
  $('gate').hidden = false;
  $('gate-msg').textContent = message;
  $('gate-signin').hidden = !canSignIn;
}

async function loadConfig() {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`config.json not available (HTTP ${res.status}).`);
  const config = await res.json();
  for (const k of CONFIG_KEYS) {
    if (typeof config[k] !== 'string' || !config[k]) throw new Error(`config.json is missing "${k}".`);
  }
  return config;
}

function route(ctx, { focus }) {
  let id = location.hash.slice(1);
  if (!Object.hasOwn(ROUTES, id)) id = DEFAULT_ROUTE;
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.getAttribute('href') === `#${id}`) {
      a.setAttribute('aria-current', 'page');
      a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // narrow tab strip
    } else a.removeAttribute('aria-current');
  }
  if (focus) ui.clearError(); // on first render keep any /admin/me error visible
  const view = $('view');
  view.replaceChildren();
  for (const mod of ROUTES[id]) {
    const section = document.createElement('section');
    section.className = 'section';
    view.append(section);
    mod.render(section, ctx);
  }
  if (focus) $('main').focus();
}

async function main() {
  ui.init({ errors: $('errors'), toasts: $('toasts') });
  $('gate-signin').addEventListener('click', () => auth.login());

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    showGate(`Cannot start: ${err.message}`, false);
    return;
  }
  auth.configure(config);

  let session;
  try {
    session = await auth.start();
  } catch (err) {
    showGate(err.message, true);
    return;
  }
  if (!session) return; // redirecting to the hosted UI

  api.configure({ apiBase: config.apiBase, getToken: auth.getIdToken, unauthorized: () => auth.login() });

  $('gate').hidden = true;
  $('shell').hidden = false;
  setWho(session.email);
  $('who').hidden = false;
  $('signout').hidden = false;
  $('signout').addEventListener('click', () => auth.signOut());

  const ctx = { api, ui, me: { email: session.email } };
  try {
    const me = await api.get('/admin/me');
    if (me?.email) {
      ctx.me.email = me.email;
      setWho(me.email);
    }
  } catch (err) {
    ui.showError(ui.errorText(err));
  }

  window.addEventListener('hashchange', () => route(ctx, { focus: true }));
  route(ctx, { focus: false });
}

main();
