import test from 'node:test';
import assert from 'node:assert/strict';
import { boxDiagonal, boxDistance, cellReach, planCells } from './plan.ts';

const optics = { fov: 60, aspect: 16 / 9, far: 1e6 };
const cell = (x: number, size = 1) => ({
  url: `cell-${x}.json`,
  sha256: '',
  bytes: 1,
  bounds: [x, 0, 0, x + 1, 1, 1],
  size,
  nodes: 1,
});

test('a cell is read up to the far plane, met on the frustum diagonal', () => {
  const tangent = Math.tan(Math.PI / 6);
  const widen = 1 + tangent * tangent * (1 + optics.aspect ** 2);
  assert.equal(cellReach({ ...optics, far: 1000 }), 1000 * Math.sqrt(widen));
  assert.equal(cellReach({ ...optics, orthographic: {} }), Infinity);
});

test('the distance to a cell is the distance to its box', () => {
  assert.equal(boxDistance([0, 0, 0, 1, 1, 1], [0.5, 0.5, 0.5]), 0, 'inside');
  assert.equal(boxDistance([0, 0, 0, 1, 1, 1], [4, 5, 0.5]), 5);
  assert.equal(boxDiagonal([0, 0, 0, 1, 2, 2]), 3);
});

test('cells are read nearest first within their reach and a diagonal, and leave two past it', () => {
  const cells = [cell(40), cell(3), cell(10), cell(200)];
  const reach = 20;
  const diagonal = Math.sqrt(3);
  const { visible, ahead, leave } = planCells(cells, [0, 0.5, 0.5], reach, new Set());
  assert.deepEqual(visible, [1, 2], 'nearest first; the one past reach + diagonal waits');
  assert.deepEqual([ahead, leave], [[], []]);
  // Held, a cell between one and two diagonals past its reach stays; past two, it leaves.
  const near = planCells(
    [cell(20 + 1.5 * diagonal), cell(20 + 2.5 * diagonal)],
    [0, 0.5, 0.5],
    reach,
    new Set([0, 1]),
  );
  assert.deepEqual(near, { visible: [], ahead: [], leave: [1] });
  const wanted = planCells([cell(20 + 0.5 * diagonal)], [0, 0.5, 0.5], reach, new Set());
  assert.deepEqual([wanted.visible, wanted.ahead], [[], [0]], 'read a diagonal ahead');
});
