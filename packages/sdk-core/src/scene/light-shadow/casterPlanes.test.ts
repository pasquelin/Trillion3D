import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneLightStore } from '../light/store.ts';
import { openPlanes, shadowCasterPlanes } from './casterPlanes.ts';
import { SUN } from './lightShadow.fixture.ts';

// A cube frustum, |x|, |y|, |z| ≤ 1: planes 2 and 3 bound y from below and from above.
const cube = () =>
  new Float64Array([1, 0, 0, 1, -1, 0, 0, 1, 0, 1, 0, 1, 0, -1, 0, 1, 0, 0, 1, 1, 0, 0, -1, 1]);
const ORIGIN = [0, 0, 0];

test('without a shadow light every frustum plane still rejects', () => {
  const store = createSceneLightStore();
  assert.equal(shadowCasterPlanes(cube(), store, ORIGIN), 0);
  store.add({ ...SUN, castsShadow: false });
  assert.equal(shadowCasterPlanes(cube(), store, ORIGIN), 0);
});

test('a sun overhead opens the plane between the view and the sky, and that one alone', () => {
  const store = createSceneLightStore();
  store.add(SUN);
  assert.equal(shadowCasterPlanes(cube(), store, ORIGIN), 1 << 3);
});

test('a lamp opens the planes it lies beyond, read in the frame of the planes', () => {
  const store = createSceneLightStore();
  store.add({ ...SUN, id: 'lamp', kind: 'point', position: [0, 5, 0], range: 20 });
  assert.equal(shadowCasterPlanes(cube(), store, ORIGIN), 1 << 3);
  // The same planes around an eye four units up: the lamp now sits on the top plane.
  assert.equal(shadowCasterPlanes(cube(), store, [0, 4, 0]), 0);
});

test('an open plane rejects nothing', () => {
  const planes = cube();
  openPlanes(planes, 1 << 3);
  assert.deepEqual([...planes.subarray(12, 16)], [0, 0, 0, 1]);
  assert.deepEqual([...planes.subarray(8, 12)], [0, 1, 0, 1]);
});
