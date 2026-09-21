import test from 'node:test';
import assert from 'node:assert/strict';
import { javascriptSiteFiles } from './check-no-js.mjs';

test('only JavaScript sources under site/ are refused', () => {
  const files = [
    'site/app/main.tsx',
    'site/demos/engine.ts',
    'site/lessons/draw.js',
    'site/reports/copy.mjs',
    'site/assets/kinetic-garden/cache/native/full/manifest.json',
    'scripts/docs-build.mjs',
    'site.js',
  ];
  assert.deepEqual(javascriptSiteFiles(files), ['site/lessons/draw.js', 'site/reports/copy.mjs']);
});
