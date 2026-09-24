// What the projection sharing of `cutSelects` must preserve: a stand-in without a sphere of its
// own takes the cluster's, and the cut no longer projects that sphere more than once. The verdict
// must stay the one the double projection used to yield — the same sphere written twice — and the
// guards `projectedClusterError` no longer poses itself must stay posed by `projectedErrorAt` and
// by `clusterErrorAtDepth`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { clusterErrorPixels } from '../../../../sdk-core/src/index.ts';
import { cutSelects, projectedClusterError } from '../selection/math.ts';

const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 200);
cam.position.set(0.4, 1.1, 7);
cam.lookAt(0.2, 0, 0);
cam.updateMatrixWorld();
const E = cam.matrixWorldInverse.elements;
const STRETCH = 1.7,
  FOCAL = 940,
  NEAR = cam.near;

test('a stand-in without a sphere of its own yields the verdict of the own sphere written twice', () => {
  for (const sphere of [
    [0, 0, 0, 1],
    [3.5, -2, -14, 0.25],
    [-0.1, 0.2, 6.9, 4],
    [0, 0, 1e6, 1e-3],
  ])
    for (const own of [0, 1e-6, 0.02, 3, Infinity])
      for (const parent of [0, 1e-6, 0.05, 9, Infinity, null, undefined])
        for (const seuil of [0, 1e-9, 0.5, 4, 1e6]) {
          const partage = { lodError: own, sphere, parentError: parent };
          // The same data, but with an explicit stand-in sphere distinct in memory: that is the
          // path that projects twice, the one from before the lot.
          const explicite = { ...partage, parentSphere: [...sphere] };
          assert.equal(
            cutSelects(partage, E, STRETCH, FOCAL, NEAR, seuil),
            cutSelects(explicite, E, STRETCH, FOCAL, NEAR, seuil),
            `own=${own} parent=${parent} seuil=${seuil} sphere=${sphere}`,
          );
        }
});

test('without a sphere, only a null error stays null: everything else is infinity', () => {
  for (const sphere of [null, undefined]) {
    assert.equal(projectedClusterError(0, sphere, 0, E, STRETCH, FOCAL, NEAR), 0);
    for (const err of [1e-9, 2, Infinity, null, undefined, -1, NaN])
      assert.equal(projectedClusterError(err, sphere, 0, E, STRETCH, FOCAL, NEAR), Infinity);
  }
});

test('a malformed error with a sphere is always refused, by the guard left downstream', () => {
  const sphere = [1, 2, -9, 0.5];
  for (const err of [-1, NaN])
    assert.throws(
      () => projectedClusterError(err, sphere, 0, E, STRETCH, FOCAL, NEAR),
      /Invalid cluster parameters/,
    );
});

test("a non-finite centre is always refused, without a guard of clusterErrorPixels's own", () => {
  for (const [x, y] of [
    [NaN, 0],
    [0, NaN],
    [Infinity, 0],
    [0, -Infinity],
    [1e200, 1e200],
  ])
    assert.throws(
      () => clusterErrorPixels(0.5, 1, x, y, -10, 0.25, 900, 0.1),
      /Invalid cluster parameters/,
      `centre (${x}, ${y})`,
    );
  // Both short-circuits stay in front of the guard: they do not read the centre.
  assert.equal(clusterErrorPixels(0, 1, NaN, NaN, -10, 0.25, 900, 0.1), 0);
  assert.equal(clusterErrorPixels(Infinity, 1, NaN, NaN, -10, 0.25, 900, 0.1), Infinity);
});
