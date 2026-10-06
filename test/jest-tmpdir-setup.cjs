// Jest globalSetup: give the whole run one private temp dir.
//
// CDK synth (Template.fromStack / app.synth() on an App with no outdir)
// writes each cloud assembly to mkdtemp(os.tmpdir(), 'cdk.out') and never
// removes it, so a full run used to leave hundreds of /tmp/cdk.out* dirs.
// Pointing TMPDIR at a per-run dir catches those (and every other
// mkdtemp(os.tmpdir()) in the tests); jest-tmpdir-teardown.cjs removes it.
//
// TMPDIR (not CDK_OUTDIR) on purpose: CDK_OUTDIR makes every App share one
// outdir and turns on autoSynth at process exit. os.tmpdir() reads TMPDIR
// on every call, and jest workers are spawned after globalSetup, so they
// inherit it; --runInBand runs in this same process.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PREFIX = 'vettid-jest-';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

module.exports = async function globalSetup() {
  const base = os.tmpdir();
  // A crashed or killed run skips globalTeardown. Remove only our own
  // leftovers whose jest process is gone, so at most one survives a crash.
  for (const name of fs.readdirSync(base)) {
    const m = new RegExp(`^${PREFIX}(\\d+)-`).exec(name);
    if (m && Number(m[1]) !== process.pid && !alive(Number(m[1]))) {
      fs.rmSync(path.join(base, name), { recursive: true, force: true });
    }
  }
  const dir = fs.mkdtempSync(path.join(base, `${PREFIX}${process.pid}-`));
  process.env.VETTID_JEST_ORIG_TMPDIR = process.env.TMPDIR ?? '';
  process.env.VETTID_JEST_TMPDIR = dir;
  process.env.TMPDIR = dir;
};
