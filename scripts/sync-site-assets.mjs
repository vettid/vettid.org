#!/usr/bin/env node
// Copies the shared brand assets (fonts, logo, favicon) from the public site
// into the app sites, which are served from their own hosts and can't load
// them cross-origin under `font-src 'self'`. website/assets is the source of
// truth; never edit the copies.
//
//   npm run sync:assets          copy
//   node scripts/sync-site-assets.mjs --check   fail on drift (CI)

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'website', 'assets');
const TARGETS = ['sites/account/assets'];
const FILES = ['fonts.css', 'favicon.png', 'logo-192.png', ...readdirSync(join(SRC, 'fonts')).map((f) => `fonts/${f}`)];

const check = process.argv.includes('--check');
const drift = [];

for (const target of TARGETS) {
  for (const f of FILES) {
    const from = join(SRC, f);
    const to = join(ROOT, target, f);
    if (check) {
      if (!existsSync(to) || !readFileSync(from).equals(readFileSync(to))) drift.push(`${target}/${f}`);
    } else {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

if (check && drift.length) {
  console.error(`sync-site-assets: out of date (run npm run sync:assets):\n  ${drift.join('\n  ')}`);
  process.exit(1);
}
console.log(check ? 'sync-site-assets check OK' : `sync-site-assets: copied ${FILES.length} files to ${TARGETS.join(', ')}`);
