// The example of `docs/SDK.md` § "Batch math for hosts", run as a test: ten thousand boxes culled
// in one call, the survivors' centres brought into view space in a second one, every buffer
// allocated once. It imports only this package: a host without `three` compiles it as-is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOX_VALUES,
  IDENTITY_MATRIX4,
  POSITION_VALUES,
  SPHERE_VALUES,
  createCameraFrame,
  frustumExcludesBox,
  frustumKeepsBoxBatch,
  perspectiveProjection,
  sphereFromBoundsBatch,
  transformAffinePoint,
  transformPointsBatch,
  updateCameraFrame,
} from '../../index.ts';

const N = 10_000;

// --- Allocated once, at scene load, and reused every frame. ---
const boxes = new Float64Array(N * BOX_VALUES); // min x, y, z then max x, y, z, per box
const kept = new Uint8Array(N); // 1 where the frustum keeps the box
const spheres = new Float64Array(N * SPHERE_VALUES); // centre x, y, z then radius, per box
const centres = new Float64Array(N * POSITION_VALUES); // survivors' centres, packed
const viewCentres = new Float64Array(N * POSITION_VALUES); // the same, in view space
const frame = createCameraFrame();
const projection = new Float64Array(16);
const cameraWorld = Float64Array.from(IDENTITY_MATRIX4); // the host's, moved below

// A hundred-by-hundred grid of unit boxes on the plane z = -20, half of it behind the camera.
for (let i = 0; i < N; i++) {
  const at = i * BOX_VALUES,
    x = (i % 100) - 50,
    y = Math.floor(i / 100) - 50,
    z = i % 2 === 0 ? -20 : 20;
  boxes[at] = x;
  boxes[at + 1] = y;
  boxes[at + 2] = z;
  boxes[at + 3] = x + 1;
  boxes[at + 4] = y + 1;
  boxes[at + 5] = z + 1;
}

/** One frame: cull, then transform the survivors. Returns how many boxes were kept. */
function cullThenTransform() {
  perspectiveProjection(projection, 60, 16 / 9, 0.1, 1);
  updateCameraFrame(frame, projection, cameraWorld, 100);
  const visible = frustumKeepsBoxBatch(kept, frame.planes, boxes, N);
  sphereFromBoundsBatch(spheres, boxes, N);
  let m = 0;
  for (let i = 0; i < N; i++) {
    if (!kept[i]) continue;
    const at = i * SPHERE_VALUES;
    centres.set(spheres.subarray(at, at + POSITION_VALUES), m++ * POSITION_VALUES);
  }
  transformPointsBatch(viewCentres, frame.view, centres, m);
  return visible;
}

test('the batches keep what the unit functions keep, and place the survivors where they do', () => {
  const visible = cullThenTransform();
  assert.ok(visible > 0 && visible < N, `${visible} of ${N} kept: some in front, some behind`);
  const one = new Float64Array(3);
  let m = 0;
  for (let i = 0; i < N; i++) {
    const at = i * BOX_VALUES;
    const excluded = frustumExcludesBox(
      frame.planes,
      boxes[at],
      boxes[at + 1],
      boxes[at + 2],
      boxes[at + 3],
      boxes[at + 4],
      boxes[at + 5],
    );
    assert.equal(kept[i], excluded ? 0 : 1, `box ${i}: the batch repeats frustumExcludesBox`);
    if (excluded) continue;
    transformAffinePoint(
      one,
      frame.view,
      boxes[at] + 0.5,
      boxes[at + 1] + 0.5,
      boxes[at + 2] + 0.5,
    );
    assert.deepEqual(
      Array.from(viewCentres.subarray(m * POSITION_VALUES, (m + 1) * POSITION_VALUES)),
      Array.from(one),
      `survivor ${m}: the batch repeats transformAffinePoint`,
    );
    assert.ok(one[2] < 0, 'a kept box sits in front of the camera');
    m++;
  }
  assert.equal(m, visible, 'the returned count is the number of ones in `kept`');
});

test('a second frame reuses every buffer: nothing is allocated per call', () => {
  const first = cullThenTransform();
  cameraWorld[14] = 5; // the camera steps back
  const second = cullThenTransform();
  assert.ok(second > first, 'a camera that steps back sees more of the grid');
  assert.equal(viewCentres[2], -24.5, 'the survivors moved with the camera, in place');
  cameraWorld[14] = 0;
});
