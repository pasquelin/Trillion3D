import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOX_VALUES,
  SPHERE_VALUES,
  boxTransformBatch,
  boxTransformUnionBatch,
  boxUnionBatch,
  frustumKeepsBoxBatch,
  linearToSrgbBatch,
  sphereFromBoundsBatch,
  srgbToLinearBatch,
  transformDirectionsBatch,
  transformPointsBatch,
  transformPointsByMatricesBatch,
} from './mathIndex.ts';
import { composeMatrix4 } from './mathMatrix4Trs.ts';
import { frustumPlanesFromMatrix } from './mathFrustum.ts';
import { perspectiveProjection } from './mathCamera.ts';

test('frustumKeepsBoxBatch: culls boxes and returns kept count', () => {
  const proj = new Float64Array(16);
  perspectiveProjection(proj, 60, 1, 0.1, 1);
  const planes = new Float64Array(24);
  frustumPlanesFromMatrix(planes, proj);

  const boxes = new Float64Array([
    -1, -1, -5, 1, 1, -3, -1, -1, 5, 1, 1, 10, 100, -1, -5, 105, 1, -3,
  ]);
  const out = new Uint8Array(3);
  const kept = frustumKeepsBoxBatch(out, planes, boxes, 3);
  assert.equal(kept, 1);
  assert.equal(out[0], 1);
  assert.equal(out[1], 0);
  assert.equal(out[2], 0);
});

test('transformPointsBatch and transformPointsByMatricesBatch: transforms points', () => {
  const m = new Float64Array(16);
  composeMatrix4(m, [10, 20, 30], [0, 0, 0, 1], [1, 1, 1]);
  const pts = new Float64Array([1, 2, 3, 4, 5, 6]);
  const out1 = new Float64Array(6);
  transformPointsBatch(out1, m, pts, 2);
  assert.equal(out1[0], 11);
  assert.equal(out1[1], 22);
  assert.equal(out1[2], 33);
  assert.equal(out1[3], 14);

  const out2 = new Float64Array(6);
  transformPointsByMatricesBatch(out2, [m, m], pts, 2);
  assert.equal(out2[0], 11);
  assert.equal(out2[3], 14);
});

test('transformDirectionsBatch: ignores translation and normalizes', () => {
  const m = new Float64Array(16);
  composeMatrix4(m, [100, 200, 300], [0, 0, 0, 1], [2, 0, 0]);
  const dirs = new Float64Array([3, 0, 0]);
  const out = new Float64Array(3);
  transformDirectionsBatch(out, m, dirs, 1);
  assert.ok(Math.abs(out[0] - 1) < 1e-10);
  assert.equal(out[1], 0);
  assert.equal(out[2], 0);
});

test('boxUnionBatch and boxTransformUnionBatch: bounds union', () => {
  const boxes = new Float64Array([0, 0, 0, 1, 1, 1, -2, -2, -2, 0, 0, 0]);
  const into = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  boxUnionBatch(into, boxes, 2);
  assert.equal(into[0], -2);
  assert.equal(into[3], 1);

  const into2 = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  const m = new Float64Array(16);
  composeMatrix4(m, [1, 1, 1], [0, 0, 0, 1], [1, 1, 1]);
  boxTransformUnionBatch(into2, boxes, [m, m], 2);
  assert.equal(into2[0], -1);
  assert.equal(into2[3], 2);
});

test('sphereFromBoundsBatch: derives sphere centre and radius', () => {
  const boxes = new Float64Array([-1, -1, -1, 1, 1, 1]);
  const out = new Float64Array(SPHERE_VALUES);
  sphereFromBoundsBatch(out, boxes, 1);
  assert.equal(out[0], 0);
  assert.equal(out[1], 0);
  assert.equal(out[2], 0);
  assert.ok(Math.abs(out[3] - Math.sqrt(3)) < 1e-10);
});

test('srgbToLinearBatch and linearToSrgbBatch: color roundtrip', () => {
  const srgb = new Float64Array([0.0, 0.5, 1.0]);
  const linear = new Float64Array(3);
  const back = new Float64Array(3);
  srgbToLinearBatch(linear, srgb, 3);
  linearToSrgbBatch(back, linear, 3);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(srgb[i] - back[i]) < 1e-10);
  }
});

test('docs example: cull 10 000 boxes then transform the survivors', () => {
  const N = 10000;
  const boxes = new Float64Array(N * BOX_VALUES);
  for (let i = 0; i < N; i++) {
    const z = i % 2 === 0 ? -5 : 5;
    boxes[i * BOX_VALUES + 0] = -1;
    boxes[i * BOX_VALUES + 1] = -1;
    boxes[i * BOX_VALUES + 2] = z - 0.5;
    boxes[i * BOX_VALUES + 3] = 1;
    boxes[i * BOX_VALUES + 4] = 1;
    boxes[i * BOX_VALUES + 5] = z + 0.5;
  }

  const proj = new Float64Array(16);
  perspectiveProjection(proj, 60, 1, 0.1, 1);
  const planes = new Float64Array(24);
  frustumPlanesFromMatrix(planes, proj);

  const keptMask = new Uint8Array(N);
  const keptCount = frustumKeepsBoxBatch(keptMask, planes, boxes, N);
  assert.equal(keptCount, 5000);

  const survivorBoxes = new Float64Array(keptCount * BOX_VALUES);
  let cursor = 0;
  for (let i = 0; i < N; i++) {
    if (keptMask[i]) {
      const src = i * BOX_VALUES;
      for (let k = 0; k < BOX_VALUES; k++) survivorBoxes[cursor + k] = boxes[src + k];
      cursor += BOX_VALUES;
    }
  }

  const transform = new Float64Array(16);
  composeMatrix4(transform, [0, 0, -10], [0, 0, 0, 1], [1, 1, 1]);
  const mats = Array.from({ length: keptCount }, () => transform);
  const transformed = new Float64Array(keptCount * BOX_VALUES);
  boxTransformBatch(transformed, survivorBoxes, mats, keptCount);

  assert.equal(transformed[2], -15.5);
  assert.equal(transformed[5], -14.5);
});
