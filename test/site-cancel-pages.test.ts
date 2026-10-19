// The two emailed cancel-link pages (sites/account/js/deletion-cancel.js,
// recovery-cancel.js) and the staging time scale (MEMBER-API 2.8.0): they
// draw the production texts at once and never wait on /config.json; on
// staging at 24 they draw again with the scaled texts and the note. A config
// that fails or never answers leaves the production texts.
//
// The pages run against a tiny fake DOM (dom.js, ui.js and api.js mocked);
// site-config.js is the real one, with fetch stubbed.

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

type Node = { tag: string; attrs: any; children: any[]; on: Record<string, (...a: any[]) => any>; addEventListener: (ev: string, fn: any) => void; focus: () => void };

const card: { kids: any[] } = { kids: [] };

jest.mock('../sites/account/js/dom.js', () => {
  const flat = (xs: any[]): any[] => xs.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false);
  return {
    el: (tag: string, attrs: any = {}, ...children: any[]): Node => {
      const n: Node = { tag, attrs, children: flat(children), on: {}, addEventListener(ev, fn) { n.on[ev] = fn; }, focus() {} };
      return n;
    },
    fill: (target: any, ...kids: any[]) => { target.kids = flat(kids); },
    $: (id: string) => (id === 'cancel-card' ? card : { focus() {} }),
  };
});
jest.mock('../sites/account/js/ui.js', () => ({
  init: () => {},
  busy: async (_b: unknown, fn: () => Promise<unknown>, opts: any) => {
    try {
      return await fn();
    } catch (err) {
      opts?.onError?.(err);
      return null;
    }
  },
  showError: () => {},
}));
const publicPost = jest.fn();
jest.mock('../sites/account/js/api.js', () => ({ publicPost: (...a: any[]) => publicPost(...a) }));

const TOKEN = 'A'.repeat(43);
const textOf = (x: any): string => (typeof x === 'string' || typeof x === 'number' ? String(x) : x && Array.isArray(x.children) ? x.children.map(textOf).join('') : '');
const cardText = () => card.kids.map(textOf).join('\n');
const button = () => card.kids.flatMap(function find(k: any): any[] { return !k || typeof k !== 'object' ? [] : k.tag === 'button' ? [k] : (k.children ?? []).flatMap(find); })[0] as Node;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function loadPage(file: 'deletion-cancel.js' | 'recovery-cancel.js', fetchImpl: () => Promise<any>) {
  card.kids = [];
  publicPost.mockReset();
  (globalThis as any).location = { hash: `#t=${TOKEN}`, pathname: '/vault/x/cancel/', search: '', hostname: 'account.staging.vettid.org' };
  (globalThis as any).history = { replaceState: () => {} };
  (globalThis as any).fetch = jest.fn(fetchImpl);
  jest.isolateModules(() => {
    require(`../sites/account/js/${file}`);
  });
}

const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const PAGES = {
  'deletion-cancel.js': { prod: 'the vault is deleted 24 hours after the request.', scaled: 'the vault is deleted 1 hour after the request.', gone: '(its 24 hours are over)', goneScaled: '(its 1 hour is over)' },
  'recovery-cancel.js': { prod: 'If that was you on a new phone, you can ignore this page.', scaled: 'If that was you on a new phone, you can ignore this page.', gone: 'its 48 hours are over', goneScaled: 'its 2 hours are over' },
} as const;

afterAll(() => {
  delete (globalThis as any).location;
  delete (globalThis as any).history;
  delete (globalThis as any).fetch;
});

describe.each(Object.keys(PAGES) as Array<keyof typeof PAGES>)('%s', (file) => {
  const p = PAGES[file];

  test('drawn at once with the production texts, before /config.json answers (it never does here)', async () => {
    loadPage(file, () => new Promise(() => {}));
    expect(cardText()).toContain(p.prod);
    expect(cardText()).not.toContain('Staging');
    await flush();
    expect(cardText()).toContain(p.prod);
    // The texts drawn after a click are production's too.
    publicPost.mockRejectedValue({ status: 404 });
    await button().on.click();
    expect(cardText()).toContain(p.gone);
  });

  test('a config that fails: the production texts stay', async () => {
    loadPage(file, () => Promise.reject(new Error('offline')));
    await flush();
    expect(cardText()).toContain(p.prod);
    expect(cardText()).not.toContain('Staging');
  });

  test('production config: the production texts, unchanged', async () => {
    loadPage(file, () => json({ stage: 'prod', release_log_url: 'https://vettid.org/security/releases/', android_app_url: null }));
    await flush();
    expect(cardText()).toContain(p.prod);
    expect(cardText()).not.toContain('Staging');
    publicPost.mockRejectedValue({ status: 404 });
    await button().on.click();
    expect(cardText()).toContain(p.gone);
  });

  test('staging at 24: drawn again with the scaled texts and the note', async () => {
    loadPage(file, () => json({ stage: 'staging', time_scale: 24 }));
    await flush();
    expect(cardText()).toContain(p.scaled);
    expect(cardText()).toContain('Staging: 1 day = 1 hour');
    publicPost.mockRejectedValue({ status: 404 });
    await button().on.click();
    expect(cardText()).toContain(p.goneScaled);
  });

  test('staging at 24, but the member clicked before the config arrived: not drawn again', async () => {
    let answer: (v: unknown) => void = () => {};
    loadPage(file, () => new Promise((r) => { answer = r; }));
    publicPost.mockReturnValue(new Promise(() => {})); // the cancel is still on its way
    void button().on.click();
    answer({ ok: true, json: () => Promise.resolve({ stage: 'staging', time_scale: 24 }) });
    await flush();
    expect(cardText()).toContain(p.prod);
    expect(cardText()).not.toContain('Staging');
  });

  test('another non-prod stage with 24 is not scaled (staging only)', async () => {
    loadPage(file, () => json({ stage: 'dev', time_scale: 24 }));
    await flush();
    expect(cardText()).toContain(p.prod);
    expect(cardText()).not.toContain('Staging');
  });
});

describe('the deletion and recovery pages: /config.json never delays the status', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  test.each(['deletion.js', 'recovery.js'])('%s reads the config (once, not awaited) before its first status fetch', (f) => {
    const js: string = readFileSync(join(__dirname, '..', 'sites', 'account', 'js', f), 'utf8');
    const load = js.slice(js.indexOf('async function load'), js.indexOf('\n}\n', js.indexOf('async function load')));
    expect(load.indexOf('readConfig();')).toBeGreaterThan(0);
    expect(load.indexOf('readConfig();')).toBeLessThan(load.indexOf("await get('/api/vault/status')"));
    expect(load).not.toMatch(/await[^;\n]*(siteConfig|configOnce)/);
    // Only a scale other than the current one (1) draws again: in production nothing changes.
    expect(js).toContain('if (c.timeScale === scale) return;');
    expect(js).toContain('configOnce ??= siteConfig()');
  });
});
