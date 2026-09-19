import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleDemoMath } from './docs-demo-bundle.mjs';

// Freshness is `pnpm run check:docs-demo`, a validate step like `check:dts`; here, behaviour:
// what the portal's demos call must really be the engine, and answer as the engine answers.
const kernels = await import(
  `data:text/javascript;base64,${Buffer.from(await bundleDemoMath()).toString('base64')}`
);

test('the bundle carries the public maths the demos call', () => {
  const missing = [
    'composeMatrix4',
    'multiplyMatrix4',
    'invertMatrix4',
    'perspectiveProjection',
    'createCameraFrame',
    'updateCameraFrame',
    'frustumExcludesBox',
    'boxConeRejects',
    'createTransformTree',
    'hierarchyUpdateBatch',
    'srgbToLinear',
    'createPathGovernor',
  ].filter((name) => typeof kernels[name] !== 'function');
  assert.deepEqual(missing, []);
});

test('it carries the tables the enum pages read, instead of a copy of them', () => {
  assert.equal(kernels.DIAGNOSTICS.overdraw.available, false);
  assert.equal(kernels.LOD_QUALITY.source.pixelError, 0);
  assert.equal(kernels.COLUMN_KIND.pageBounds, 'f64');
});

test('the depth convention comes from the engine, not from the page', () => {
  assert.equal(kernels.DEPTH_CLEAR, 0);
  assert.equal(kernels.DEPTH_NEAR, 1);
  assert.equal(kernels.DEPTH_COMPARE_OR_EQUAL, 'greater-equal');
});

test('the projection it exports is the reversed one, with an infinite far plane', () => {
  const projection = kernels.perspectiveProjection(new Float64Array(16), 50, 1, 0.1, 1);
  assert.equal(projection[14], 0.1);
  assert.equal(projection[10], 0);
  assert.equal(projection[11], -1);
});
