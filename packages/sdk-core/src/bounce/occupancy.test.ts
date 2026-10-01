import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMap, cellsAround, occupiedAt, point, scene, type Box } from './occupancy.fixture.ts';

/** Scenes of one to four levels, some off the origin, with geometry on their corners and inside. */
const SCENES: { bounds: number[]; boxes: Box[] }[] = [
  { bounds: [0, 0, 0, 1, 1, 0], boxes: [[0, 0, 0, 1, 1, 0]] },
  {
    bounds: [0, 0, 0, 20, 3, 3],
    boxes: [point([0, 0, 0]), point([20, 3, 3]), [6, 1, 1, 7.5, 2, 1]],
  },
  {
    bounds: [0, 0, 0, 64, 3, 3],
    boxes: [point([0, 0, 0]), point([64, 3, 3]), point([31.875, 1.5, 0])],
  },
  { bounds: [0, 0, 0, 64, 10, 10], boxes: [point([0, 0, 0]), point([64, 10, 10])] },
  {
    bounds: [-37.25, 5.25, -9.875, 10.125, 9, -4],
    boxes: [point([-37.25, 5.25, -9.875]), point([10.125, 9, -4]), [-20, 6, -8, -12, 7, -7]],
  },
  { bounds: [10, 20, 30, 40, 26, 36], boxes: [[10, 20, 30, 12, 22, 30], point([40, 26, 36])] },
];

test('the map holds the cells around the geometry at every level, and nothing else', () => {
  for (const { bounds, boxes } of SCENES) {
    const { occupancy, cascades } = scene(bounds, boxes);
    assertMap(occupancy, cascades, bounds, boxes, `${bounds}`);
  }
});

test('an empty proxy keeps no cell, and a level past the plan reads the coarsest', () => {
  const empty = scene([0, 0, 0, 20, 3, 3], []);
  assert.equal(empty.occupancy.marked, 0);
  assertMap(empty.occupancy, empty.cascades, [0, 0, 0, 20, 3, 3], [], 'empty');
  const { occupancy, cascades } = scene([0, 0, 0, 64, 3, 3], [point([31.875, 1.5, 0])]);
  const last = cascades.levels.length - 1;
  for (const cell of cellsAround(cascades, last, [0, 0, 0, 64, 3, 3]).cells)
    assert.equal(
      occupiedAt(occupancy, last + 3, cell),
      occupiedAt(occupancy, last, cell),
      `${cell}`,
    );
});

test('the map counts its finest cells and the bytes of every level', () => {
  for (const { bounds, boxes } of SCENES) {
    const { occupancy, cascades } = scene(bounds, boxes);
    const { cells } = cellsAround(cascades, 0, bounds, 0);
    assert.ok(occupancy.cells >= cells.length, `${bounds}: the finest map spans the extent`);
    assert.ok(occupancy.cells >= occupancy.marked);
    const coarser = occupancy.bytes - occupancy.cells;
    if (cascades.levels.length === 1) assert.equal(coarser, 0, `${bounds}`);
    // Each coarser level halves the cells per axis: an eighth of the one before, or a little more.
    else assert.ok(coarser > 0 && coarser < occupancy.cells, `${bounds}: ${coarser}`);
  }
});
