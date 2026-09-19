import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUNDLE_PATH, bundleDemoMath } from './docs-demo-bundle.mjs';

test('the committed demo bundle is the current sdk-core kernels', async () => {
  const committed = readFileSync(resolve(import.meta.dirname, '..', BUNDLE_PATH), 'utf8');
  assert.equal(committed, await bundleDemoMath());
});

test('the demo bundle exports the three kernels the page runs', async () => {
  const url = `data:text/javascript;base64,${Buffer.from(await bundleDemoMath()).toString('base64')}`;
  const kernels = await import(url);
  assert.deepEqual(Object.keys(kernels).sort(), [
    'composeMatrix4',
    'multiplyMatrix4',
    'perspectiveProjection',
  ]);
  const projection = kernels.perspectiveProjection(new Float64Array(16), 50, 1, 0.1, 1);
  assert.equal(projection[14], 0.1);
  assert.equal(projection[10], 0);
});
