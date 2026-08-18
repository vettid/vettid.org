#!/usr/bin/env node
// Static checks for the website — the things that have actually bitten us:
// unbalanced tags/braces, inline styles creeping back, stale vettid.dev
// references, and internal links pointing at files that don't exist.
// Run via `npm run check:site`; CI runs it on every push.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

if (errors.length) {
  console.error(`check:site FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`check:site OK — ${htmlFiles.length} pages verified`);
