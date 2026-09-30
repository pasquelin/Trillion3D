import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { updateTransportVisibility } from './visibility.ts';
import { sceneWithBlocker } from '../../../../../tests/fixtures/lightingTransportScene.ts';

test('visibility traces known receiver cells, removes occluded hits and restores cached rays', () => {
  let scene = sceneWithBlocker(true, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  // Four parallel rays land in the four emitter quadrants. All other rays escape upwards.
  for (let ray = 0; ray < state.totalRays; ray++) state.rays.set([0.01, 10, 10, 0, 1, 0], ray * 6);
  for (const [sample, [y, z]] of [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ].entries())
    state.rays.set([0.01, y, z, 1, 0, 0], sample * 6);
  const visible = updateTransportVisibility(state, scene, 'rebuild', {}, true, true);
  assert.deepEqual(visible, {
    raysTraced: 36,
    movingRayTests: 36,
    staticSurfaceTests: 72,
    rowsUpdated: 9,
  });
  assert.deepEqual([...state.firstHit.slice(0, 4)], [4, 5, 6, 7]);
  assert.deepEqual([...state.counts.slice(0, 9)], [0, 0, 0, 0, 1, 1, 1, 1, 0]);
  assert.deepEqual([...state.matrix.slice(0, 9)], [0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25, 0]);
  assert.equal(state.rowSums[0], 1);
  assert.deepEqual(
    [...state.staticUv.slice(0, 8)],
    [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75],
  );
  state.initialized = true;
  const originalRays = state.rays.slice();
  for (const open of [false, true]) {
    scene = sceneWithBlocker(open, 1);
    const changed = updateTransportGeometry(state, scene, {});
    // Keep the deliberately selected physical rays also for the moving patch's row.
    state.rays.set(originalRays);
    const result = updateTransportVisibility(
      state,
      scene,
      'reuse',
      {},
      changed.geometryChanged,
      changed.staticChanged,
    );
    assert.equal(result.raysTraced, 4);
    assert.equal(result.movingRayTests, 36);
    assert.equal(result.staticSurfaceTests, 8);
    assert.equal(result.rowsUpdated, 1);
    assert.deepEqual([...state.firstHit.slice(0, 4)], open ? [4, 5, 6, 7] : [8, 8, 8, 8]);
    assert.equal(state.rowSums[0], 1);
    assert.equal(state.matrix[8], open ? 0 : 1);
  }
  assert.deepEqual(updateTransportVisibility(state, scene, 'reuse', {}, false, false), {
    raysTraced: 0,
    movingRayTests: 0,
    staticSurfaceTests: 0,
    rowsUpdated: 0,
  });
});

test('sphere occlusion and panel backs absorb rays without producing receiving patches', () => {
  for (const obstruction of ['sphere', 'back'] as const) {
    const scene = sceneWithBlocker(true, 1);
    if (obstruction === 'sphere') scene.sphere = { center: [1, 0, 0], radius: 0.3, roughness: 0.2 };
    const state = createTransportState(scene, { raysPerPatch: 4 });
    updateTransportGeometry(state, scene, {});
    for (let ray = 0; ray < state.totalRays; ray++)
      state.rays.set(
        obstruction === 'sphere' ? [0.01, 0, 0, 1, 0, 0] : [3, 0, 0, -1, 0, 0],
        ray * 6,
      );
    updateTransportVisibility(state, scene, 'rebuild', {}, true, true);
    assert.ok(state.firstHit.every((value) => value === -1));
    assert.ok(state.matrix.every((value) => value === 0));
    assert.ok(state.rowSums.every((value) => value === 0));
    assert.ok(
      state.staticDistance.every(
        (distance) => Math.abs(distance - (obstruction === 'sphere' ? 0.69 : 1)) < 1e-12,
      ),
    );
    if (obstruction === 'sphere') assert.ok(state.staticUv.every((value) => value === -1));
  }
});
