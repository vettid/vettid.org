// The account deletion's two pages (MEMBER-API 2.14.0; ACCOUNT-ADMIN-PLAN
// §5.4.4, §5.4.6): /account/delete/ (sites/account/js/account-delete.js) and
// the emailed cancel link's /account/delete/cancel/ (account-delete-cancel.js).
// They run against a tiny fake DOM (dom.js, ui.js and api.js mocked), as in
// site-cancel-pages.test.ts.

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Node = { tag: string; attrs: any; children: any[]; on: Record<string, (...a: any[]) => any>; addEventListener: (ev: string, fn: any) => void; focus: () => void; value?: string; checked?: boolean };

const roots: Record<string, { kids: any[] }> = { 'cancel-card': { kids: [] }, 'acct-del': { kids: [] } };
const shown: { errors: string[]; notices: string[] } = { errors: [], notices: [] };

jest.mock('../sites/account/js/dom.js', () => {
  const flat = (xs: any[]): any[] => xs.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false);
  return {
    el: (tag: string, attrs: any = {}, ...children: any[]): Node => {
      const n: Node = { tag, attrs, children: flat(children), on: { ...(attrs?.on ?? {}) }, addEventListener(ev, fn) { n.on[ev] = fn; }, focus() {} };
      if (tag === 'input') { n.value = ''; n.checked = !!attrs?.checked; }
      return n;
    },
    fill: (target: any, ...kids: any[]) => { target.kids = flat(kids); },
    $: (id: string) => roots[id] ?? { focus() {} },
  };
});
jest.mock('../sites/account/js/ui.js', () => ({
  init: () => {},
  busy: async (_b: unknown, fn: () => Promise<unknown>, opts: any) => {
    try {
      return await fn();
    } catch (err) {
      if (opts?.onError) opts.onError(err);
      else shown.errors.push((err as any)?.message);
      return null;
    }
  },
  showError: (e: any) => shown.errors.push(typeof e === 'string' ? e : e?.message),
  showNotice: (t: string) => shown.notices.push(t),
  errorText: (e: any) => e?.message ?? 'error',
  field: (label: string, control: any, opts: any = {}) => ({ tag: 'div', attrs: {}, children: [label, control, opts.hint ?? null].filter(Boolean), on: {} }),
  checkRow: (input: any, label: string) => ({ tag: 'div', attrs: {}, children: [input, label], on: {} }),
  pinInput: (attrs: any) => ({ tag: 'input', attrs: { ...attrs, pin: true }, children: [], on: {}, value: '', focus() {} }),
  checkPin: (i: any) => (/^\d{4,8}$/.test(i.value) ? i.value : null),
  fieldError: () => {},
}));
const publicPost = jest.fn();
const get = jest.fn();
const post = jest.fn();
jest.mock('../sites/account/js/api.js', () => ({ publicPost: (...a: any[]) => publicPost(...a), get: (...a: any[]) => get(...a), post: (...a: any[]) => post(...a) }));

const textOf = (x: any): string => (typeof x === 'string' || typeof x === 'number' ? String(x) : x && Array.isArray(x.children) ? x.children.map(textOf).join('') : '');
const all = (root: string) => roots[root].kids;
const text = (root: string) => all(root).map(textOf).join('\n');
const find = (root: string, pred: (n: any) => boolean): any[] => all(root).flatMap(function walk(k: any): any[] { return !k || typeof k !== 'object' ? [] : [...(pred(k) ? [k] : []), ...(k.children ?? []).flatMap(walk)]; });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const apiError = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });

const G = '11111111-2222-4333-8444-555555555555';
const TOKEN = `${G}.${'A'.repeat(43)}`;

function load(file: string, hash = '', arrange: () => void = () => {}) {
  for (const r of Object.values(roots)) r.kids = [];
  shown.errors = [];
  shown.notices = [];
  publicPost.mockReset();
  get.mockReset();
  post.mockReset();
  arrange();
  const replaceState = jest.fn();
  (globalThis as any).location = { hash, pathname: '/account/delete/cancel/', search: '' };
  (globalThis as any).history = { replaceState };
  jest.isolateModules(() => {
    require(`../sites/account/js/${file}`);
  });
  return replaceState;
}

afterAll(() => {
  delete (globalThis as any).location;
  delete (globalThis as any).history;
});

describe('/account/delete/cancel/ (the emailed link)', () => {
  test('the fragment is stripped from the address bar on load, and nothing is sent until the button', async () => {
    const replaceState = load('account-delete-cancel.js', `#t=${TOKEN}`);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/account/delete/cancel/');
    await flush();
    expect(publicPost).not.toHaveBeenCalled();
    expect(text('cancel-card')).toBe(
      'Keep your VettID account?\nSomeone asked, from your account, to delete it. If you want to keep it, cancel the deletion.\nCancel the deletion',
    );
  });

  test('Cancel the deletion: the token, to the cancel route only; cancelled', async () => {
    load('account-delete-cancel.js', `#t=${TOKEN}`);
    publicPost.mockResolvedValue({ cancelled: true });
    await find('cancel-card', (n) => n.tag === 'button')[0].on.click();
    expect(publicPost.mock.calls).toEqual([['/api/account/deletion/cancel-link', { token: TOKEN }]]);
    expect(text('cancel-card')).toContain('Your account is open again. Sign in as before.');
  });

  test.each([
    ['cancelled false', () => publicPost.mockResolvedValue({ cancelled: false })],
    ['404 (the account is deleted)', () => publicPost.mockRejectedValue(apiError(404, 'not_found', 'x'))],
  ])('%s: the link no longer works', async (_n, arrange) => {
    load('account-delete-cancel.js', `#t=${TOKEN}`);
    arrange();
    await find('cancel-card', (n) => n.tag === 'button')[0].on.click();
    expect(text('cancel-card')).toContain('This link no longer works: the deletion was already cancelled, or carried out.');
  });

  test.each([[500], [429], [0]])('a failure (%s): the "try again" text, the button stays', async (status) => {
    load('account-delete-cancel.js', `#t=${TOKEN}`);
    publicPost.mockRejectedValue(apiError(status, 'x', 'x'));
    await find('cancel-card', (n) => n.tag === 'button')[0].on.click();
    expect(shown.errors).toEqual(["We couldn't cancel the deletion just now. Try the link again in a few minutes; it keeps working until your account is deleted."]);
    expect(find('cancel-card', (n) => n.tag === 'button')).toHaveLength(1);
  });

  test('no token, or not one of ours: no button, nothing sent', async () => {
    for (const h of ['', '#t=nope', `#t=${'A'.repeat(43)}`]) {
      load('account-delete-cancel.js', h);
      await flush();
      expect(find('cancel-card', (n) => n.tag === 'button')).toEqual([]);
      expect(text('cancel-card')).toContain('This link no longer works');
    }
    expect(publicPost).not.toHaveBeenCalled();
  });
});

describe('/account/delete/', () => {
  const page = async (state: unknown) => {
    load('account-delete.js', '', () => (state instanceof Error ? get.mockRejectedValue(state) : get.mockResolvedValue(state)));
    await flush();
  };

  test('not signed in: sign in first', async () => {
    await page(apiError(401, 'unauthorized', 'You are not signed in.'));
    expect(get).toHaveBeenCalledWith('/api/account/deletion', { redirect: false });
    expect(textOf(find('acct-del', (n) => n.tag === 'h2')[0])).toBe('Delete your VettID account.');
    expect(text('acct-del')).toContain('Sign in first, then choose Delete my account on your account page.');
    expect(find('acct-del', (n) => n.tag === 'a').map((a) => [textOf(a), a.attrs.href])).toEqual([['Sign in', '/signin/']]);
    expect(find('acct-del', (n) => n.tag === 'form')).toEqual([]);
  });

  test('a vault: the vault text, with the start-over', async () => {
    await page({ blocked_by: { vaults: [{ vault_id: 'a', state: 'locked' }] }, pin_required: false, mailing_list: false });
    expect(text('acct-del')).toContain('You still have a vault.');
    expect(text('acct-del')).toContain('Your VettID account can be deleted only after your vault. Delete your vault in the VettID app, or here with Delete my vault and start over, which takes 24 hours. Then come back to this page.');
    expect(find('acct-del', (n) => n.tag === 'a').map((a) => a.attrs.href)).toContain('/account/vault/deletion/');
    expect(find('acct-del', (n) => n.tag === 'form')).toEqual([]);
  });

  test('an unfinished setup: its own text', async () => {
    await page({ blocked_by: { vaults: [{ vault_id: 'a', state: 'enrolling' }] }, pin_required: false, mailing_list: false });
    expect(text('acct-del')).toContain("Your vault setup isn't finished.");
    expect(text('acct-del')).toContain('Your VettID account can be deleted only when no vault is left. Finish setting up your vault in the VettID app and then delete it there, or write to support@vettid.org to end the setup.');
  });

  test('the form: the box (ticked) only when on the list, the PIN only when set; the request carries what was typed', async () => {
    await page({ blocked_by: null, pin_required: true, mailing_list: true });
    expect(text('acct-del')).toContain('Also remove me from the VettID mailing list');
    const inputs = find('acct-del', (n) => n.tag === 'input');
    const [box, phrase, pin, code] = inputs;
    expect(box.attrs.type).toBe('checkbox');
    expect(box.checked).toBe(true);
    expect(pin.attrs.pin).toBe(true);
    // Email me a code.
    post.mockResolvedValue({ expires_at: 'x' });
    await find('acct-del', (n) => n.tag === 'button' && textOf(n) === 'Email me a code')[0].on.click();
    expect(post.mock.calls[0][0]).toBe('/api/account/deletion/code');
    // Delete my account.
    phrase.value = 'delete my account';
    pin.value = '4826';
    code.value = '123456';
    box.checked = false;
    post.mockResolvedValue({ deletion_id: 'D', requested_at: '2026-11-03T10:00:00.000Z', deletes_at: '2026-11-10T10:00:00.000Z' });
    await find('acct-del', (n) => n.tag === 'form')[0].on.submit({ preventDefault() {} });
    expect(post.mock.calls[1]).toEqual(['/api/account/deletion', { confirm: 'delete my account', code: '123456', pin: '4826', remove_from_mailing_list: false }, { redirect: false }]);
    expect(textOf(find('acct-del', (n) => n.tag === 'h2')[0])).toBe('Your account is closed.');
    expect(text('acct-del')).toContain("It will be deleted after 11 November 2026, 07:00 UTC. We're emailing you a link that cancels the deletion.");
  });

  test('no box when not on the list (and false is sent); a wrong phrase is not sent', async () => {
    await page({ blocked_by: null, pin_required: false, mailing_list: false });
    expect(text('acct-del')).not.toContain('mailing list"');
    const [phrase, code] = find('acct-del', (n) => n.tag === 'input');
    phrase.value = 'Delete my account';
    code.value = '123456';
    await find('acct-del', (n) => n.tag === 'form')[0].on.submit({ preventDefault() {} });
    expect(post).not.toHaveBeenCalled();
    phrase.value = 'delete my account';
    post.mockResolvedValue({ deletes_at: '2026-11-10T06:00:00.000Z' });
    await find('acct-del', (n) => n.tag === 'form')[0].on.submit({ preventDefault() {} });
    expect(post.mock.calls[0][1]).toEqual({ confirm: 'delete my account', code: '123456', remove_from_mailing_list: false });
    expect(text('acct-del')).toContain('It will be deleted after 10 November 2026, 07:00 UTC.');
  });

  test("the deletion's 500 (or a lost connection): never a retry, the text that the account may be closed", async () => {
    for (const status of [500, 0]) {
      await page({ blocked_by: null, pin_required: false, mailing_list: false });
      const [phrase, code] = find('acct-del', (n) => n.tag === 'input');
      phrase.value = 'delete my account';
      code.value = '123456';
      post.mockRejectedValue(apiError(status, 'internal', 'Internal error'));
      await find('acct-del', (n) => n.tag === 'form')[0].on.submit({ preventDefault() {} });
      expect(text('acct-del')).toContain("Something went wrong, and your account may already be closed. Don't try again: check your email for the cancel link. If no email comes within an hour, write to support@vettid.org.");
      expect(find('acct-del', (n) => n.tag === 'form')).toEqual([]);
    }
  });

  test("the code's errors: the API's texts (PIN, code, limits); a 500 is the code's own text", async () => {
    await page({ blocked_by: null, pin_required: false, mailing_list: false });
    post.mockRejectedValue(apiError(429, 'rate_limited', "You've asked for 3 codes in the last hour. Try again later."));
    const ask = find('acct-del', (n) => n.tag === 'button' && textOf(n) === 'Email me a code')[0];
    await ask.on.click();
    post.mockRejectedValue(apiError(500, 'internal', 'Internal error'));
    await ask.on.click();
    expect(shown.errors).toEqual(["You've asked for 3 codes in the last hour. Try again later.", "We couldn't send the code. Nothing has changed. Try again in a few minutes, or write to support@vettid.org."]);
  });

  test('the page text: what is deleted, the 7 days, the cancel link, what stays', async () => {
    await page({ blocked_by: null, pin_required: false, mailing_list: true });
    expect(text('acct-del')).toContain(
      'This deletes your membership, your sign-in, your subscription and your email address from VettID (unless you stay on the mailing list). ' +
        "Your account is closed at once and deleted after 7 days. Until then you can cancel with the link we email you. After that it can't be undone. " +
        "A record that your account existed stays in our security log. Any copy of your email address in our logs is deleted within 90 days, and in AWS's own audit log within 400 days.",
    );
  });
});

describe('the account site', () => {
  const site = (...p: string[]) => readFileSync(join(__dirname, '..', 'sites', 'account', ...p), 'utf8');
  test('the pages exist and load their scripts; no innerHTML', () => {
    expect(site('account', 'delete', 'index.html')).toContain('<script type="module" src="/js/account-delete.js"></script>');
    expect(site('account', 'delete', 'cancel', 'index.html')).toContain('<script type="module" src="/js/account-delete-cancel.js"></script>');
    for (const f of ['account-delete.js', 'account-delete-cancel.js']) expect(site('js', f)).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });

  test("the account page's Cancel is a link to /account/delete/; nothing posts to the withdrawn route", () => {
    const js = site('js', 'account.js');
    expect(js).toContain("href: '/account/delete/'");
    expect(js).not.toContain('/api/account/cancel');
    expect(site('guide', 'index.html')).not.toContain('Cancel any time');
  });
});
