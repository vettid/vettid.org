// Jest globalTeardown: remove the per-run temp dir from jest-tmpdir-setup.cjs.
const fs = require('node:fs');

module.exports = async function globalTeardown() {
  const dir = process.env.VETTID_JEST_TMPDIR;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  const orig = process.env.VETTID_JEST_ORIG_TMPDIR;
  if (orig) process.env.TMPDIR = orig;
  else delete process.env.TMPDIR;
  delete process.env.VETTID_JEST_TMPDIR;
  delete process.env.VETTID_JEST_ORIG_TMPDIR;
};
