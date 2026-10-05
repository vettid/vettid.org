module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // Prefer TypeScript sources over stale tsc output (`npm run build` emits
  // .js next to each .ts, and jest would otherwise resolve those first).
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    // The site's browser ES modules, for test/site-vault.test.ts.
    '^.+/sites/.+\\.js$': '<rootDir>/test/site-esm-transform.cjs'
  }
};
