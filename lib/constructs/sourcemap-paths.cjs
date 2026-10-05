// Makes a bundled Lambda's source map independent of where it was bundled.
//
// esbuild writes each entry of a source map's `sources` relative to the
// bundle's output directory. CDK bundles into <outdir>/bundling-temp-<key>,
// so the paths (and with them the asset hash, which hashes the bundle's
// output: index.mjs AND index.mjs.map) depend on where the cloud assembly
// is written relative to the repo. With the default `cdk.out` in the repo
// root every path is `../../<repo-relative path>` on any machine; with
// `cdk synth -o /elsewhere`, a test's temp dir, or a nested assembly they
// are not, and the same code gets a different asset hash.
//
// ApiFunction's afterBundling hook runs this on the output directory. It
// rewrites every source to `../../<path relative to the project root>`:
// exactly what esbuild produces for the default `cdk.out`, so the default
// case is byte-for-byte unchanged (deployed asset hashes stay the same),
// and every other output location now produces the same bytes too. The
// production drift check (RUNBOOK "Production drift") relies on this to
// compare asset hashes synthesized in CI with the ones deployed from the
// owner's checkout.
//
// Plain CommonJS on purpose: the hook runs it with `node` during bundling
// (no TypeScript loader there).
//
//   node lib/constructs/sourcemap-paths.cjs <outputDir> <projectRoot>
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** esbuild's layout of the `sources` line (one line, `", "`-separated). */
const SOURCES_LINE = /^( {2}"sources": )(\[.*\]),$/m;

/**
 * The map text with each source rewritten to `../../<project-relative path>`.
 * Everything else, including formatting, is left as is. Throws when the map
 * does not have esbuild's layout, so a change in esbuild fails the bundle
 * loudly instead of silently producing path-dependent hashes again.
 */
function normalizeSourceMap(text, outputDir, projectRoot) {
  const m = SOURCES_LINE.exec(text);
  if (!m) throw new Error('sourcemap-paths: no esbuild-style "sources" line in the source map');
  const sources = JSON.parse(m[2]);
  if (!Array.isArray(sources) || !sources.every((s) => typeof s === 'string')) {
    throw new Error('sourcemap-paths: "sources" is not an array of strings');
  }
  const rewritten = sources.map((s) => {
    const rel = path.relative(projectRoot, path.resolve(outputDir, s)).split(path.sep).join('/');
    return `../../${rel}`;
  });
  const line = `[${rewritten.map((s) => JSON.stringify(s)).join(', ')}]`;
  return text.slice(0, m.index) + m[1] + line + ',' + text.slice(m.index + m[0].length);
}

/** Rewrites every `*.map` file directly in outputDir; returns how many. */
function normalizeDir(outputDir, projectRoot) {
  let n = 0;
  for (const name of fs.readdirSync(outputDir)) {
    if (!name.endsWith('.map')) continue;
    const file = path.join(outputDir, name);
    const before = fs.readFileSync(file, 'utf8');
    const after = normalizeSourceMap(before, outputDir, projectRoot);
    if (after !== before) fs.writeFileSync(file, after);
    n++;
  }
  return n;
}

module.exports = { normalizeSourceMap, normalizeDir };

if (require.main === module) {
  const [outputDir, projectRoot] = process.argv.slice(2);
  if (!outputDir || !projectRoot) {
    console.error('usage: node sourcemap-paths.cjs <outputDir> <projectRoot>');
    process.exit(2);
  }
  normalizeDir(path.resolve(outputDir), path.resolve(projectRoot));
}
