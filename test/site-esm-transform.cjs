// Jest transform for the account site's browser modules (sites/*/js/*.js):
// they are plain ES modules served as-is, so for the (CommonJS) test run
// esbuild rewrites import/export only. Nothing else changes.
const { transformSync } = require('esbuild');

module.exports = {
  process(src, filename) {
    const out = transformSync(src, { loader: 'js', format: 'cjs', target: 'node20', sourcefile: filename, sourcemap: 'inline' });
    return { code: out.code };
  },
};
