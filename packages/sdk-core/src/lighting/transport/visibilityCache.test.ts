import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { updateTransportVisibility } from './visibility.ts';
import { sceneWithBlocker } from '../../../../../tests/fixtures/lightingTransportScene.ts';

test('cached hits remap receiver zero after patches exchange cells on an unchanged surface', () => {
  const scene = sceneWithBlocker(true, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  for (let ray = 0; ray < state.totalRays; ray++) state.rays.set([1.99, -1, -1, -1, 0, 0], ray * 6);
  const rays = state.rays.slice();
  updateTransportVisibility(state, scene, 'reuse', {}, true, true);
  assert.ok(state.firstHit.every((value) => value === 0));
  state.initialized = true;
  [scene.patches[0].center, scene.patches[1].center] = [
    scene.patches[1].center,
    scene.patches[0].center,
  ];
  const change = updateTransportGeometry(state, scene, {});
  state.rays.set(rays);
  updateTransportVisibility(
    state,
    scene,
    'reuse',
    {},
    change.geometryChanged,
    change.staticChanged,
  );
  assert.ok(state.firstHit.every((value) => value === 1));
  for (let row = 0; row < state.size; row++) {
    assert.equal(state.counts[row * state.size], 0);
    assert.equal(state.counts[row * state.size + 1], 4);
  }
  const result = updateTransportVisibility(state, scene, 'rebuild', {}, false, false);
  assert.equal(result.rowsUpdated, 9);
  assert.ok(state.firstHit.every((value) => value === 1));
  assert.ok(state.rowSums.every((value) => value === 1));
});

test('the back of a moving panel absorbs a ray rather than becoming a diffuse receiver', () => {
  const scene = sceneWithBlocker(false, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  for (let ray = 0; ray < state.totalRays; ray++) state.rays.set([1.5, 0, 0, -1, 0, 0], ray * 6);
  updateTransportVisibility(state, scene, 'rebuild', {}, true, true);
  assert.ok(state.firstHit.every((value) => value === -1));
  assert.ok(state.matrix.every((value) => value === 0));
});
