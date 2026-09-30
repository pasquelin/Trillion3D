import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingSceneGeometry, createLightingScenePatches } from './geometry.ts';

test('scene rectangles produce independent centered patches and obey the inclusive patch budget', () => {
  const geometry = createLightingSceneGeometry(1);
  geometry.rectangle('panel', [3, 4, 5], [2, 0, 0], [0, 2, 0], [0.2, 0.3, 0.4]);
  const surface = geometry.surfaces[0];
  assert.equal(surface.moving, false);
  assert.equal(surface.kind, 'diffuse');
  assert.deepEqual([surface.columns, surface.rows], [2, 2]);
  const patches = createLightingScenePatches(geometry.surfaces);
  assert.deepEqual(
    patches.map((patch) => patch.center),
    [
      [3.5, 4.5, 5],
      [4.5, 4.5, 5],
      [3.5, 5.5, 5],
      [4.5, 5.5, 5],
    ],
  );
  assert.deepEqual(patches[0].normal, [0, 0, 1]);
  assert.deepEqual(patches[0].u, [1, 0, 0]);
  assert.deepEqual(patches[0].v, [0, 1, 0]);
  assert.deepEqual(patches[0].albedo, [0.2, 0.3, 0.4]);
  patches[0].albedo[0] = 1;
  assert.equal(surface.albedo[0], 0.2);
  assert.equal(patches[1].albedo[0], 0.2);
  const full = createLightingSceneGeometry(1);
  assert.doesNotThrow(() =>
    full.rectangle('large', [0, 0, 0], [128, 0, 0], [0, 128, 0], [1, 1, 1]),
  );
  assert.throws(
    () => full.rectangle('extra', [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 1]),
    /16384 transport patches/,
  );
});

test('scene box faces stay on their bounds with outward normals and selected subdivisions', () => {
  const geometry = createLightingSceneGeometry(1);
  geometry.box('box', [1, 2, 3], [3, 5, 7], [0.2, 0.3, 0.4], ['px']);
  assert.ok(geometry.surfaces.every((surface) => !surface.moving));
  const patches = createLightingScenePatches(geometry.surfaces);
  const center = [2, 3.5, 5];
  for (const patch of patches) {
    assert.ok(
      patch.center.every((value, axis) => value >= [1, 2, 3][axis] && value <= [3, 5, 7][axis]),
    );
    assert.ok(
      patch.normal.reduce(
        (sum, value, axis) => sum + value * (patch.center[axis] - center[axis]),
        0,
      ) > 0,
    );
  }
  assert.equal(patches.length, 17);
});
