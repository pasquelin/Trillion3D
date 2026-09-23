import test from 'node:test';
import assert from 'node:assert/strict';
import { javascriptFiles } from './check-no-js.ts';

test('every JavaScript source anywhere in the repository is refused', () => {
  const files = [
    'site/app/main.tsx',
    'site/demos/engine.ts',
    'site/app/draw.js',
    'site/reports/copy.mjs',
    'site/assets/kinetic-garden/cache/native/full/manifest.json',
    'scripts/docs-build.mjs',
    'site.js',
  ];
  assert.deepEqual(javascriptFiles(files), [
    'site/app/draw.js',
    'site/reports/copy.mjs',
    'scripts/docs-build.mjs',
    'site.js',
  ]);
});

test('.ts, .mts and .tsx sources pass', () => {
  const files = ['scripts/x.ts', 'packages/sdk-node/y.mts', 'site/app/main.tsx'];
  assert.deepEqual(javascriptFiles(files), []);
});
