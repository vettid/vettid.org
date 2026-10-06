module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // One temp dir per run (TMPDIR), removed at the end: CDK synth output and
  // other mkdtemp(os.tmpdir()) dirs no longer pile up in /tmp.
  globalSetup: '<rootDir>/test/jest-tmpdir-setup.cjs',
  globalTeardown: '<rootDir>/test/jest-tmpdir-teardown.cjs',
  // Prefer TypeScript sources over stale tsc output (`npm run build` emits
  // .js next to each .ts, and jest would otherwise resolve those first).
  moduleFileExtensions: ['ts', 'js', 'cjs', 'json'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    // The site's browser ES modules, for test/site-vault.test.ts.
    '^.+/sites/.+\\.js$': '<rootDir>/test/site-esm-transform.cjs'
  }
};
