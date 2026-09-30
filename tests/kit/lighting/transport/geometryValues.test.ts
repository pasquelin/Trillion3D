import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { sceneWithBlocker, sceneFromSurfaces } from '../../../fixtures/lightingTransportScene.ts';

test('geometry tracks moving, static and sphere edits independently and refreshes material data', () => {
  let scene = sceneWithBlocker(false, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  const update = () => updateTransportGeometry(state, scene, {});
  assert.deepEqual(update(), { geometryChanged: true, staticChanged: true });
  assert.deepEqual([...state.cellPatch], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...state.cellOffsets], [0, 4, 8]);
  assert.deepEqual([...state.source.slice(12, 15)], [4, 1, 0.5]);
  assert.deepEqual([...state.albedo.slice(0, 3)], [0.6, 0.25, 0.2]);
  state.initialized = true;
  const rays = state.rays.slice();
  assert.deepEqual(update(), { geometryChanged: false, staticChanged: false });
  assert.ok(state.patchChanged.every((value) => value === 0));
  assert.deepEqual(state.rays, rays);
  scene = sceneWithBlocker(true, 2);
  assert.deepEqual(update(), { geometryChanged: true, staticChanged: false });
  assert.deepEqual([...state.patchChanged], [0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual([...state.source.slice(12, 15)], [8, 2, 1]);
  scene.surfaces[0].origin[0] = -1;
  scene = sceneFromSurfaces(scene.surfaces);
  assert.deepEqual(update(), { geometryChanged: true, staticChanged: true });
  scene.sphere = { center: [1, 2, 3], radius: 0.5, roughness: 0.2 };
  assert.deepEqual(update(), { geometryChanged: true, staticChanged: true });
  assert.deepEqual(state.sphereGeometry, [1, 2, 3, 0.5]);
  assert.deepEqual(update(), { geometryChanged: false, staticChanged: false });
  for (let axis = 0; axis < 3; axis++) {
    scene.sphere.center[axis] += 1;
    assert.deepEqual(update(), { geometryChanged: true, staticChanged: true });
    assert.deepEqual(update(), { geometryChanged: false, staticChanged: false });
  }
  scene.sphere.radius = 0.8;
  assert.deepEqual(update(), { geometryChanged: true, staticChanged: true });
  delete scene.sphere;
  assert.deepEqual(update(), { geometryChanged: true, staticChanged: true });
  assert.equal(state.sphereGeometry, null);
});

test('geometry rejects incompatible topology and surfaces with missing or duplicate cells', () => {
  const mutations: Array<(scene: ReturnType<typeof sceneWithBlocker>) => void> = [
    (s) => {
      s.patches.pop();
    },
    (s) => {
      s.surfaces.pop();
    },
    (s) => {
      s.surfaces[0].id = 'other';
    },
    (s) => {
      s.surfaces[0].columns++;
    },
    (s) => {
      s.surfaces[0].rows++;
    },
    (s) => {
      s.surfaces[0].moving = true;
    },
    (s) => {
      s.patches[0].surface = 1;
    },
  ];
  for (const mutate of mutations) {
    const scene = sceneWithBlocker(false, 1);
    const state = createTransportState(scene, {});
    mutate(scene);
    assert.throws(
      () => updateTransportGeometry(state, scene, {}),
      (error: any) => error.code === 'INCOMPATIBLE_SCENE' && error.message.length > 20,
    );
  }
  for (const center of [
    [0, -2.01, -1],
    [0, 2, -1],
    [0, -1, -2.01],
    [0, -1, 2],
  ]) {
    const scene = sceneWithBlocker(false, 1);
    const state = createTransportState(scene, {});
    scene.patches[0].center = center as [number, number, number];
    assert.throws(
      () => updateTransportGeometry(state, scene, {}),
      (error: any) => error.code === 'INVALID_SCENE' && error.message.includes('outside'),
    );
  }
  const scene = sceneWithBlocker(false, 1);
  const state = createTransportState(scene, {});
  scene.patches[1].center = [...scene.patches[0].center];
  assert.throws(
    () => updateTransportGeometry(state, scene, {}),
    (error: any) => error.code === 'INVALID_SCENE' && error.message.includes('same surface cell'),
  );
});

test('skew surfaces translated on every axis map shuffled patches into their physical cells', () => {
  const base = sceneWithBlocker(false, 1).surfaces[0];
  const scene = sceneFromSurfaces([{ ...base, origin: [3, 4, 5], u: [2, 3, 4], v: [4, 2, 1] }]);
  scene.patches.reverse().forEach((patch, id) => {
    patch.id = id;
  });
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  assert.deepEqual([...state.cellPatch], [3, 2, 1, 0]);
  state.initialized = true;
  assert.deepEqual(updateTransportGeometry(state, scene, {}), {
    geometryChanged: false,
    staticChanged: false,
  });
});
