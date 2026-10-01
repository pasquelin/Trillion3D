import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { updateTransportVisibility } from './visibility.ts';
import type { Vec3 } from '../scene/experimentScene.ts';
import { sceneWithBlocker } from '../../../../../tests/fixtures/lightingTransportScene.ts';
import { nearestHit } from '../../../../../tests/fixtures/lightingSceneTestHelpers.ts';

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
  const still = scene.surfaces.filter((surface) => !surface.moving).length;
  assert.deepEqual(visible, {
    raysTraced: state.totalRays,
    movingRayTests: state.totalRays * (scene.surfaces.length - still),
    staticSurfaceTests: state.totalRays * still,
    rowsUpdated: state.size,
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
    // Only the moved blocker's own patch recasts its rays; every ray tests the blocker again.
    assert.equal(result.raysTraced, state.raysPerPatch);
    assert.equal(result.movingRayTests, state.totalRays);
    assert.equal(result.staticSurfaceTests, state.raysPerPatch * still);
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

test('a ray on the far edge of a surface lands in its last cell', () => {
  const scene = sceneWithBlocker(true, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  for (let ray = 0; ray < state.totalRays; ray++) state.rays.set([0.01, 2, -2, 1, 0, 0], ray * 6);
  updateTransportVisibility(state, scene, 'rebuild', {}, true, true);
  assert.ok(state.firstHit.every((value) => value === 7));
});

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

test('each row holds the share of its rays that first meet each patch, as an independent cast finds', () => {
  for (const open of [true, false]) {
    const scene = sceneWithBlocker(open, 1);
    const state = createTransportState(scene, { raysPerPatch: 64 });
    updateTransportGeometry(state, scene, {});
    updateTransportVisibility(state, scene, 'rebuild', {}, true, true);
    const expected = new Float64Array(state.size * state.size);
    for (let ray = 0; ray < state.totalRays; ray++) {
      const at = ray * 6;
      const hit = nearestHit(
        scene,
        [...state.rays.slice(at, at + 3)] as Vec3,
        [...state.rays.slice(at + 3, at + 6)] as Vec3,
      );
      if (!hit?.front) continue;
      const surface = scene.surfaces[hit.surface];
      const column = Math.min(surface.columns - 1, Math.floor(hit.u * surface.columns)),
        row = Math.min(surface.rows - 1, Math.floor(hit.v * surface.rows));
      // The scene lists each surface's patches row by row (`sceneFromSurfaces`).
      const receiver =
        scene.patches.findIndex((patch) => patch.surface === hit.surface) +
        row * surface.columns +
        column;
      expected[Math.floor(ray / state.raysPerPatch) * state.size + receiver] +=
        1 / state.raysPerPatch;
    }
    state.matrix.forEach((value, i) =>
      assert.ok(Math.abs(value - expected[i]) < 1e-12, `${open} ${i}`),
    );
    assert.ok(state.matrix.some((value) => value > 0));
  }
});
