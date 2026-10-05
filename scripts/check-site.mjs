#!/usr/bin/env node
// Static checks for the website — the things that have actually bitten us:
// unbalanced tags/braces, inline styles creeping back, stale vettid.dev
// references, and internal links pointing at files that don't exist.
// Run via `npm run check:site`; CI runs it on every push.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'website');
const errors = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const htmlFiles = walk(ROOT).filter((p) => p.endsWith('.html'));

for (const file of htmlFiles) {
  const rel = file.slice(ROOT.length + 1);
  const src = readFileSync(file, 'utf8');

  // 1. Tag balance for structural elements
  for (const tag of ['section', 'div', 'header', 'footer', 'ul', 'svg', 'form', 'style', 'script']) {
    const open = (src.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;
    const close = (src.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    if (open !== close) errors.push(`${rel}: <${tag}> open/close mismatch (${open}/${close})`);
  }

  // 2. CSS brace balance inside <style>
  for (const m of src.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    const bal = (m[1].match(/{/g) ?? []).length - (m[1].match(/}/g) ?? []).length;
    if (bal !== 0) errors.push(`${rel}: unbalanced CSS braces (${bal})`);
  }

  // 3. No inline style attributes (all styling lives in stylesheets/classes)
  const inline = src.match(/ style="/g) ?? [];
  if (inline.length > 0) errors.push(`${rel}: ${inline.length} inline style attribute(s)`);

  // 4. No stale vettid.dev references
  if (/vettid\.dev/i.test(src)) errors.push(`${rel}: references vettid.dev`);

  // 5. Internal hrefs/srcs resolve to real files (clean URLs map to dir/index.html)
  for (const m of src.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
    const path = m[1];
    if (path === '/') continue;
    // /playbooks/* is a separate CloudFront origin (vettid-playbooks repo),
    // not part of this file tree
    if (path === '/playbooks/' || path.startsWith('/playbooks/')) continue;
    const direct = join(ROOT, path);
    const asIndex = join(ROOT, path, 'index.html');
    if (!existsSync(direct) && !existsSync(asIndex)) {
      errors.push(`${rel}: broken internal link ${path}`);
    }
  }
}

// 6. Header/nav chrome is styled ONLY in shared/nav.css — the one copy the
// playbooks origin also loads. A redefinition anywhere else (site.css, a
// page <style> block) is exactly how the two sections drift apart.
const CHROME_SELECTORS = /(?:^|[\s,{}])(?:header\s*\{|header\.site\b|\.header-logo\b|\.coming-soon-chip\b|\.desktop-nav\b|\.nav-toggle\b|\.nav-menu\b|\.nav-overlay\b)/;
for (const file of walk(ROOT).filter((p) => p.endsWith('.css') || p.endsWith('.html'))) {
  const rel = file.slice(ROOT.length + 1);
  if (rel === join('shared', 'nav.css')) continue;
  let css = file.endsWith('.css') ? readFileSync(file, 'utf8') : '';
  if (file.endsWith('.html')) {
    for (const m of readFileSync(file, 'utf8').matchAll(/<style>([\s\S]*?)<\/style>/g)) css += m[1];
  }
  // Strip comments, then test rule text (selectors + declarations); the
  // selector tokens are distinctive enough not to appear in declarations.
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of css.split('\n')) {
    if (CHROME_SELECTORS.test(line)) {
      errors.push(`${rel}: styles header/nav chrome ("${line.trim().slice(0, 60)}") — belongs in shared/nav.css only`);
    }
  }
}

// 7. Every top-level entry under website/ is listed in the WAF probe-path
// allowlist (CONTENT_PREFIXES in web-stack.ts). Anything missing there is
// counted as scanner traffic, and real visitors to the new section get
// rate-limited at 25 requests per 5 minutes.
{
  const stack = readFileSync(join(ROOT, '..', 'lib', 'stacks', 'web-stack.ts'), 'utf8');
  const m = stack.match(/const CONTENT_PREFIXES = \[([\s\S]*?)\];/);
  if (!m) {
    errors.push('web-stack.ts: CONTENT_PREFIXES not found');
  } else {
    const prefixes = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    for (const name of readdirSync(ROOT)) {
      if (name === 'index.html' || name.startsWith('.')) continue;
      const route = '/' + name.replace(/\.html$/, '');
      if (!prefixes.some((p) => route.startsWith(p) || (route + '/').startsWith(p))) {
        errors.push(`web-stack.ts: CONTENT_PREFIXES is missing ${route} (website/${name})`);
      }
    }
  }
}

// 8. The app sites (sites/*: account, admin, staging) are served with a
// strict CSP (script-src/style-src 'self', require-trusted-types-for):
// no inline scripts, styles or event handlers, balanced structure, and
// internal links — in the HTML and the page paths the JS builds — that
// resolve to files the deployment publishes (the edge function's 404 file
// list is built from the same tree, lib/constructs/static-site.ts).
const SITES = join(ROOT, '..', 'sites');
let appPages = 0;
for (const site of readdirSync(SITES)) {
  const dir = join(SITES, site);
  if (!statSync(dir).isDirectory()) continue;
  const files = walk(dir).filter((p) => !p.slice(dir.length + 1).split('/').some((seg) => seg.startsWith('.')));
  const resolves = (path) => {
    if (path === '/' || path.startsWith('/api/') || path.startsWith('/.well-known/') || path === '/config.json') return true;
    return existsSync(join(dir, path)) || existsSync(join(dir, path, 'index.html'));
  };
  for (const file of files.filter((p) => p.endsWith('.html'))) {
    appPages += 1;
    const rel = `sites/${site}/${file.slice(dir.length + 1)}`;
    const src = readFileSync(file, 'utf8');
    for (const tag of ['section', 'div', 'header', 'footer', 'main', 'ul', 'ol', 'svg', 'form', 'script']) {
      const open = (src.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;
      const close = (src.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      if (open !== close) errors.push(`${rel}: <${tag}> open/close mismatch (${open}/${close})`);
    }
    if (/ style="/.test(src)) errors.push(`${rel}: inline style attribute (CSP style-src 'self')`);
    if (/<style[\s>]/.test(src)) errors.push(`${rel}: <style> block (CSP style-src 'self')`);
    for (const m of src.matchAll(/<script\b([^>]*)>/g)) {
      if (!/\ssrc="/.test(m[1])) errors.push(`${rel}: inline <script> (CSP script-src 'self')`);
    }
    if (/\son[a-z]+="/i.test(src)) errors.push(`${rel}: inline event handler attribute`);
    if (/vettid\.dev/i.test(src)) errors.push(`${rel}: references vettid.dev`);
    for (const m of src.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
      if (!resolves(m[1])) errors.push(`${rel}: broken internal link ${m[1]}`);
    }
  }
  for (const file of files.filter((p) => p.endsWith('.js'))) {
    const rel = `sites/${site}/${file.slice(dir.length + 1)}`;
    const src = readFileSync(file, 'utf8');
    // Parses as the browser loads it (classic theme-init.js, ES modules otherwise).
    const asModule = !file.endsWith('theme-init.js');
    const syntax = spawnSync(process.execPath, [`--input-type=${asModule ? 'module' : 'commonjs'}`, '--check'], { input: src, encoding: 'utf8' });
    if (syntax.status !== 0) errors.push(`${rel}: syntax error: ${(syntax.stderr.match(/SyntaxError: .*/) ?? [syntax.stderr.trim()])[0]}`);
    if (file.includes('/vendor/')) continue;
    if (/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/.test(src)) {
      errors.push(`${rel}: HTML/script string sink (Trusted Types: build DOM with createElement/textContent)`);
    }
    if (/\.style\.|setAttribute\(\s*'style'/.test(src)) errors.push(`${rel}: inline style write (CSP style-src 'self')`);
    // Page paths built in JS: '/x/y/' or '/x/#tab' string literals.
    for (const m of src.matchAll(/['`](\/[a-z0-9][a-z0-9/-]*\/)(?:#[a-z]+)?['`]/g)) {
      if (!resolves(m[1])) errors.push(`${rel}: link to missing page ${m[1]}`);
    }
  }
}

if (errors.length) {
  console.error(`check:site FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`check:site OK — ${htmlFiles.length} website pages and ${appPages} app-site pages verified`);
