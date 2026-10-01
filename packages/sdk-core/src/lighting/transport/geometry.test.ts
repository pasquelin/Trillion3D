import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import {
  sceneWithBlocker,
  sceneFromSurfaces,
} from '../../../../../tests/fixtures/lightingTransportScene.ts';

test('geometry tracks moving, static and sphere edits independently and refreshes material data', () => {
  let scene = sceneWithBlocker(false, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  const update = () => updateTransportGeometry(state, scene, {});
  assert.deepEqual(update(), { geometryChanged: true, staticChanged: true });
  // Patches are built row by row, surface by surface: each sits in the cell of its own number.
  assert.deepEqual(
    [...state.cellPatch],
    scene.patches.map((patch) => patch.id),
  );
  let cells = 0;
  scene.surfaces.forEach((surface, i) => {
    assert.equal(state.cellOffsets[i], cells);
    cells += surface.columns * surface.rows;
  });
  const material = (key: 'emission' | 'albedo') => scene.patches.flatMap((patch) => patch[key]);
  assert.deepEqual([...state.source], material('emission'));
  assert.deepEqual([...state.albedo], material('albedo'));
  state.initialized = true;
  const rays = state.rays.slice();
  assert.deepEqual(update(), { geometryChanged: false, staticChanged: false });
  assert.ok(state.patchChanged.every((value) => value === 0));
  assert.deepEqual(state.rays, rays);
  scene = sceneWithBlocker(true, 2);
  assert.deepEqual(update(), { geometryChanged: true, staticChanged: false });
  assert.deepEqual([...state.patchChanged], [0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual([...state.source], material('emission'));
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

test('surface geometry changes invalidate visibility even when contained patch samples stay unchanged', () => {
  const scene = sceneWithBlocker(true, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  state.initialized = true;
  scene.surfaces[0].u[1] = 4.5;
  const events: unknown[] = [];
  assert.deepEqual(
    updateTransportGeometry(state, scene, { onProgress: (event) => events.push(event) }),
    { geometryChanged: true, staticChanged: true },
  );
  assert.ok(state.patchChanged.every((value) => value === 0));
  assert.deepEqual(
    events,
    [0, 3].map((completed) => ({ eventVersion: 1, stage: 'geometry', completed, total: 3 })),
  );
});
