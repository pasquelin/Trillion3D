import test from 'node:test';
import assert from 'node:assert/strict';
import type { Vec3 } from './types.ts';
import {
  createLightingSceneGeometry,
  createLightingScenePatches,
  MAX_LIGHTING_PATCHES,
} from './geometry.ts';
import { close, cross, dot, sub } from '../../../../../tests/fixtures/lightingSceneTestHelpers.ts';

test('a detailed rectangle is cut into cells no larger than the patch size, centred in its cells', () => {
  const geometry = createLightingSceneGeometry(1);
  geometry.rectangle('panel', [3, 4, 5], [2, 0, 0], [0, 2, 0], [0.2, 0.3, 0.4]);
  const [surface] = geometry.surfaces;
  assert.deepEqual(
    [surface.columns, surface.rows, surface.moving, surface.kind, surface.emission],
    [2, 2, false, 'diffuse', [0, 0, 0]],
  );
  const patches = createLightingScenePatches(geometry.surfaces);
  assert.deepEqual(
    patches.map((patch) => [patch.id, patch.surface, patch.center]),
    [
      [0, 0, [3.5, 4.5, 5]],
      [1, 0, [4.5, 4.5, 5]],
      [2, 0, [3.5, 5.5, 5]],
      [3, 0, [4.5, 5.5, 5]],
    ],
  );
  for (const patch of patches)
    assert.deepEqual(
      [patch.normal, patch.u, patch.v, patch.area, patch.albedo],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0], 1, [0.2, 0.3, 0.4]],
    );
});

test('a side holding a whole number of patches is cut into that number despite rounding', () => {
  const geometry = createLightingSceneGeometry(0.1);
  // 1.1 / 0.1 is 11.000000000000002 in binary64.
  geometry.rectangle('panel', [0, 0, 0], [1.1, 0, 0], [0, 0.35, 0], [1, 1, 1]);
  assert.deepEqual([geometry.surfaces[0].columns, geometry.surfaces[0].rows], [11, 4]);
});

test('an undetailed rectangle stays one patch, and a mirror reflects no diffuse light', () => {
  const geometry = createLightingSceneGeometry(0.5);
  const emission: Vec3 = [1, 2, 3];
  geometry.rectangle(
    'glass',
    [0, 0, 0],
    [4, 0, 0],
    [0, 4, 0],
    [0.9, 0.9, 0.9],
    false,
    true,
    'mirror',
    emission,
  );
  const [surface] = geometry.surfaces;
  assert.deepEqual(
    [surface.columns, surface.rows, surface.moving, surface.kind],
    [1, 1, true, 'mirror'],
  );
  const [patch] = createLightingScenePatches(geometry.surfaces);
  assert.deepEqual([patch.albedo, patch.emission, patch.area], [[0, 0, 0], emission, 16]);
  assert.deepEqual(surface.albedo, [0.9, 0.9, 0.9]);
});

test('patches own their vectors: editing one changes neither its surface nor another patch', () => {
  const geometry = createLightingSceneGeometry(1);
  const albedo: Vec3 = [0.2, 0.3, 0.4];
  geometry.rectangle('panel', [0, 0, 0], [2, 0, 0], [0, 1, 0], albedo);
  albedo[0] = 1;
  const [first, second] = createLightingScenePatches(geometry.surfaces);
  for (const key of ['normal', 'u', 'v', 'albedo', 'emission'] as const) first[key][0] = 7;
  for (const key of ['normal', 'u', 'v', 'albedo', 'emission'] as const)
    assert.notEqual(second[key][0], 7, key);
  assert.deepEqual(geometry.surfaces[0].albedo, [0.2, 0.3, 0.4]);
  assert.deepEqual(geometry.surfaces[0].emission, [0, 0, 0]);
});

test('a scene holds patches up to its budget and refuses one more', () => {
  const full = createLightingSceneGeometry(1);
  full.rectangle('large', [0, 0, 0], [MAX_LIGHTING_PATCHES - 1, 0, 0], [0, 1, 0], [1, 1, 1]);
  assert.doesNotThrow(() => full.rectangle('last', [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 1]));
  assert.throws(
    () => full.rectangle('extra', [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 1]),
    RangeError,
  );
});

test('a box has six faces on its bounds facing out, only the detailed ones subdivided', () => {
  const geometry = createLightingSceneGeometry(1);
  const min: Vec3 = [1, 2, 3],
    max: Vec3 = [3, 5, 7];
  geometry.box('box', min, max, [0.2, 0.3, 0.4], ['px']);
  assert.deepEqual(
    geometry.surfaces.map((surface) => [surface.id, surface.columns * surface.rows]),
    [
      ['box_nx', 1],
      ['box_px', 12],
      ['box_ny', 1],
      ['box_py', 1],
      ['box_nz', 1],
      ['box_pz', 1],
    ],
  );
  const middle = min.map((value, axis) => (value + max[axis]) / 2) as Vec3;
  for (const surface of geometry.surfaces) {
    const normal = cross(surface.u, surface.v);
    const corners = [
      surface.origin,
      [0, 1, 2].map((a) => surface.origin[a] + surface.u[a] + surface.v[a]) as Vec3,
    ];
    for (const corner of corners)
      assert.ok(
        corner.every((value, axis) => value >= min[axis] && value <= max[axis]),
        surface.id,
      );
    // A face lies on a bound plane: its corners share one coordinate, a bound of the box.
    const axis = normal.findIndex((value) => value !== 0);
    assert.ok([min[axis], max[axis]].includes(surface.origin[axis]), surface.id);
    assert.ok(dot(normal, sub(surface.origin, middle)) > 0, surface.id);
    close(
      Math.hypot(...normal),
      ((max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2])) / (max[axis] - min[axis]),
    );
    assert.equal(surface.moving, false);
  }
});

test('a moving box places its faces through its point and turns its sides through its vector map', () => {
  const geometry = createLightingSceneGeometry(1);
  const shift = ([x, y, z]: Vec3): Vec3 => [x + 10, y, z];
  const turn = ([x, y, z]: Vec3): Vec3 => [-x, y, -z];
  geometry.box('door', [0, 0, 0], [1, 1, 1], [1, 1, 1], [], true, shift, turn);
  const still = createLightingSceneGeometry(1);
  still.box('door', [0, 0, 0], [1, 1, 1], [1, 1, 1], []);
  geometry.surfaces.forEach((surface, i) => {
    const reference = still.surfaces[i];
    assert.equal(surface.moving, true);
    assert.deepEqual(surface.origin, shift(reference.origin));
    assert.deepEqual([surface.u, surface.v], [turn(reference.u), turn(reference.v)]);
  });
});
