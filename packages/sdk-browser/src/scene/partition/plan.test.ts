import test from 'node:test';
import assert from 'node:assert/strict';
import { AHEAD, boxDistance, cellReach, KEEP, planCells, residentRows } from './plan.ts';

const optics = { fov: 60, aspect: 16 / 9, far: 1e6 };
const cell = (x: number) => ({ bounds: [x, 0, 0, x + 1, 1, 1], meshes: [[0, 1] as const] });

test('a cell is read up to the far plane, met on the frustum diagonal', () => {
  const tangent = Math.tan(Math.PI / 6);
  const widen = 1 + tangent * tangent * (1 + optics.aspect ** 2);
  assert.equal(cellReach({ ...optics, far: 1000 }), 1000 * Math.sqrt(widen));
  assert.equal(cellReach({ ...optics, orthographic: {} }), Infinity);
});

test('the distance to a cell is the distance to its box', () => {
  assert.equal(boxDistance([0, 0, 0, 1, 1, 1], [0.5, 0.5, 0.5]), 0, 'inside');
  assert.equal(boxDistance([0, 0, 0, 1, 1, 1], [4, 5, 0.5]), 5);
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

test('the rows held at once follow the reach, mesh by mesh, and not the length of the world', () => {
  // A row of unit cells one metre apart, each placing one node of mesh 0; every tenth also two of
  // mesh 1. Two cells can be held together while their gap is within twice the keep radius.
  const row = (length: number) =>
    Array.from({ length }, (_, at) => {
      const placed = cell(2 * at);
      return at % 10 ? placed : { ...placed, meshes: [[0, 1] as const, [1, 2] as const] };
    });
  const reach = 10;
  const short = residentRows(row(100), reach),
    long = residentRows(row(1600), reach);
  assert.deepEqual([...long], [...short], 'sixteen times the world, the same rows');
  // Cells within 2·reach·(1 + KEEP) = 30 m of one another, 2 m apart: fifteen on each side.
  const span = Math.floor((2 * reach * (1 + KEEP)) / 2);
  assert.equal(short.get(0), 2 * span + 1);
  assert.ok(short.get(1)! >= 2 && short.get(1)! <= 2 * Math.ceil((2 * span + 1) / 10));
  // An orthographic camera reads every cell: its rows hold the world.
  assert.equal(residentRows(row(100), Infinity).get(0), 100);
});
