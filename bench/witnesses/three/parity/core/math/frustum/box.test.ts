// Lot M2, frustumBox.ts: box against viewing frustum — inside, outside, straddling, and a box
// intersecting the near plane —, compared against planes built independently and tested box by box and point by point.
//
// Clipping is `[0, 1]` on both sides; only depth DIRECTION differs, which swaps the
// NEAR plane and the FAR plane. The six planes are therefore the same set, in another order — and
// a box verdict only reads a set.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  clipPlanesFromMatrix,
  frustumClipBox,
  frustumExcludesBox,
  frustumPlanesFromMatrix,
} from '../../../../../../../packages/sdk-core/src/index.ts';
import { boite3 } from '../../../../../../oracles/core/volumes.ts';
import {
  frustumClipBoxBefore,
  hostileFloats,
} from '../../../../../../oracles/core/hot-path-math.ts';

function camera() {
  const cam = new THREE.PerspectiveCamera(50, 1.3, 0.5, 200);
  cam.coordinateSystem = THREE.WebGPUCoordinateSystem;
  cam.updateProjectionMatrix();
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}
const vp = camera();
const frustum = new THREE.Frustum().setFromProjectionMatrix(vp, THREE.WebGPUCoordinateSystem);
const planes = new Float64Array(24);
frustumPlanesFromMatrix(planes, vp.elements);
const raw = new Float64Array(24);
clipPlanesFromMatrix(raw, vp.elements);

/** Three-way state built with public host-library primitives, independent of frustumBox.ts. */
function stateThree(b: number[]) {
  const box = boite3(b);
  if (!frustum.intersectsBox(box)) return 0;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) => new THREE.Vector3(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]),
  );
  return corners.every((c) => frustum.containsPoint(c)) ? 2 : 1;
}

// Camera is at z = 10, looking at origin: near plane (near = 0.5) cuts world at
// z = 9.5, inside of frustum is on z < 9.5 side.
test('box entirely inside, in front of near plane, yields 2 and is not excluded', () => {
  const b = [-0.15, -0.15, 9.0, 0.15, 0.15, 9.3];
  assert.equal(stateThree(b), 2);
  assert.equal(
    frustumClipBox(planes, ...(b as [number, number, number, number, number, number])),
    2,
  );
  assert.equal(
    frustumExcludesBox(planes, ...(b as [number, number, number, number, number, number])),
    false,
  );
});

test('box entirely outside, far to the side, yields 0 and is excluded', () => {
  const b = [500, 500, 500, 501, 501, 501];
  assert.equal(stateThree(b), 0);
  assert.equal(
    frustumClipBox(planes, ...(b as [number, number, number, number, number, number])),
    0,
  );
  assert.equal(
    frustumExcludesBox(planes, ...(b as [number, number, number, number, number, number])),
    true,
  );
});

test('box straddling left plane, far from near plane, yields 1 and is not excluded', () => {
  const b = [5, -0.5, -1, 7, 0.5, 1];
  assert.equal(stateThree(b), 1);
  assert.equal(
    frustumClipBox(planes, ...(b as [number, number, number, number, number, number])),
    1,
  );
  assert.equal(
    frustumExcludesBox(planes, ...(b as [number, number, number, number, number, number])),
    false,
  );
});

test('box intersecting near plane (z = 9.5) yields 1, never 0 nor 2', () => {
  const b = [-0.3, -0.3, 9.3, 0.3, 0.3, 9.7];
  assert.equal(stateThree(b), 1);
  const state = frustumClipBox(planes, ...(b as [number, number, number, number, number, number]));
  assert.equal(state, 1);
  assert.equal(
    frustumExcludesBox(planes, ...(b as [number, number, number, number, number, number])),
    false,
  );
});

test('verdict is identical with raw (unnormalized) planes and normalized planes', () => {
  const boxes = [
    [-0.15, -0.15, 9.0, 0.15, 0.15, 9.3],
    [500, 500, 500, 501, 501, 501],
    [5, -0.5, -1, 7, 0.5, 1],
    [-0.3, -0.3, 9.3, 0.3, 0.3, 9.7],
  ];
  for (const b of boxes) {
    const c = b as [number, number, number, number, number, number];
    assert.equal(frustumClipBox(raw, ...c), frustumClipBox(planes, ...c));
    assert.equal(frustumExcludesBox(raw, ...c), frustumExcludesBox(planes, ...c));
  }
});

test('hostile box (NaN or inverted bounds) never rejects: comparison with NaN always fails', () => {
  assert.equal(frustumExcludesBox(planes, NaN, 0, 9, 0, 0, 10), false);
  assert.equal(frustumExcludesBox(planes, 1, 1, 1, -1, -1, -1), false); // inverted
});

test('both tests keep the verdicts of the indexed bounds they replace, on 300 000 hostile cases', () => {
  const f = hostileFloats(9170);
  const seen = [0, 0, 0];
  const hostile = new Float64Array(24);
  for (let i = 0; i < 300_000; i++) {
    for (let k = 0; k < 24; k++) hostile[k] = f(1);
    const tested = i % 2 ? hostile : planes;
    const lo = [f(), f(), f() + 5];
    const b = [...lo, ...lo.map((v) => v + Math.abs(f(1)))];
    const c = b as [number, number, number, number, number, number];
    const before = frustumClipBoxBefore(tested, b);
    const excluded = frustumExcludesBox(tested, ...c);
    if (frustumClipBox(tested, ...c) !== before || excluded !== (before === 0))
      assert.fail(`box ${b}, planes ${tested}`);
    seen[before]++;
  }
  assert.ok(
    seen.every((n) => n > 0),
    `every state met: ${seen}`,
  );
});
