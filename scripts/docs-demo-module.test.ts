import test from 'node:test';
import assert from 'node:assert/strict';

// The demos import this module and the site build bundles it as `js/engine.js`, the module the
// code editor's snippets import. Here, behaviour: what the portal's demos call must really be the
// engine, and answer as it.
const kernels = await import('../site/demos/engine.ts');

test('the bundle carries the public maths the demos call', () => {
  // A record derived from the namespace's own entries, so a dynamic name lookup stays typed
  // without widening the namespace import itself.
  const exports: Record<string, unknown> = Object.fromEntries(Object.entries(kernels));
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
  ].filter((name) => typeof exports[name] !== 'function');
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
