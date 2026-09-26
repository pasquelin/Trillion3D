import test from 'node:test';
import assert from 'node:assert/strict';
import { AHEAD, boxDistance, cellReach, inCellFrame, KEEP, planCells } from './plan.ts';

const optics = { fov: 60, aspect: 16 / 9, near: 0.1, far: 1e6, zoom: 1 };
const cell = (x: number) => ({ bounds: [x, 0, 0, x + 1, 1, 1], meshes: [[0, 1] as const] });

test('a cell is read up to the far plane, met on the frustum diagonal', () => {
  const tangent = Math.tan(Math.PI / 6);
  const widen = 1 + tangent * tangent * (1 + optics.aspect ** 2);
  assert.equal(cellReach({ ...optics, far: 1000 }), 1000 * Math.sqrt(widen));
});

test('the reach follows the zoom: its frustum, and an orthographic box, widen as it shrinks', () => {
  const slope = Math.tan(Math.PI / 6) / 0.5;
  const widen = 1 + slope * slope * (1 + optics.aspect ** 2);
  assert.equal(cellReach({ ...optics, far: 1000, zoom: 0.5 }), 1000 * Math.sqrt(widen));
  // The box `[-10, 10] × [-5, 5]` at zoom 0.5 sees `[-20, 20] × [-10, 10]` up to its far plane.
  const box = { left: -10, right: 10, top: 5, bottom: -5 };
  const orthographic = { ...optics, far: 1000, zoom: 0.5, orthographic: box };
  assert.equal(cellReach(orthographic), Math.hypot(1000, 20, 10));
  // A negative near plane draws behind the eye, as far as it goes.
  assert.equal(cellReach({ ...orthographic, near: -2000 }), Math.hypot(2000, 20, 10));
});

test('a sheared root reads every cell the world reach holds, by its least singular value', () => {
  // `(x, y, z) → (x + y, y, z)`: every column is at least 1 long, yet it shrinks the direction
  // `(1, −0.618…, 0)` by 0.618…, the golden ratio's inverse.
  const shear = [1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const local = [1, (1 - Math.sqrt(5)) / 2, 0];
  const world = Math.hypot(local[0] + local[1], local[1], local[2]);
  const { eye, reach } = inCellFrame(shear, [0, 0, 0], world);
  assert.ok(Math.hypot(...local) <= reach * (1 + 1e-12), `${Math.hypot(...local)} > ${reach}`);
  assert.deepEqual(eye, [0, 0, 0]);
  const flat = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.equal(inCellFrame(flat, [0, 0, 0], 1).reach, Infinity, 'a flattened root reads all');
});

test('the distance to a cell is the distance to its box', () => {
  assert.equal(boxDistance([0, 0, 0, 1, 1, 1], [0.5, 0.5, 0.5]), 0, 'inside');
  assert.equal(boxDistance([0, 0, 0, 1, 1, 1], [4, 5, 0.5]), 5);
  // A cell under two parents is as near as its nearest box, never the box around both.
  const split = [0, 0, 0, 1, 1, 1, 100, 0, 0, 101, 1, 1];
  assert.equal(boxDistance(split, [50, 0.5, 0.5]), 49);
});

test('cells are read nearest first within their reach, ahead past it, and leave further', () => {
  const cells = [cell(40), cell(3), cell(10), cell(200)];
  const reach = 20;
  const { visible, ahead, leave } = planCells(cells, [0, 0.5, 0.5], reach, new Set());
  assert.deepEqual(visible, [1, 2], 'nearest first; the one past the prefetch margin waits');
  assert.deepEqual([ahead, leave], [[], []]);
  // Held, a cell between the reach and its keep margin stays; past it, it leaves.
  const near = planCells(
    [cell(reach * (1 + KEEP) - 1), cell(reach * (1 + KEEP) + 1)],
    [0, 0.5, 0.5],
    reach,
    new Set([0, 1]),
  );
  assert.deepEqual(near, { visible: [], ahead: [], leave: [1] });
  const wanted = planCells([cell(reach * (1 + AHEAD) - 1)], [0, 0.5, 0.5], reach, new Set());
  assert.deepEqual([wanted.visible, wanted.ahead], [[], [0]], 'read ahead of the reach');
  // A cell far wider than the reach is kept only while its box meets the keep sphere.
  const wide = { ...cell(0), bounds: [0, 0, 0, 1000, 1, 1] };
  const past = reach * (1 + KEEP) + 1;
  assert.deepEqual(planCells([wide], [1000 + past, 0.5, 0.5], reach, new Set([0])).leave, [0]);
});
