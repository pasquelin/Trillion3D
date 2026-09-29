import test from 'node:test';
import assert from 'node:assert/strict';
import type { TableRegion } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createCellBoxes } from './boxes.ts';
import { createCellIndex } from './cellIndex.ts';

/** A square world of `side` × `side` cells of 10 m, under the core node `rank` or the root, in
 *  the order the cook halves them (`split.rs`), and its pages: halves down to region pages of
 *  four cells, as the pager cuts them (`pages.rs`). */
function world(side: number, rank: number | null = null) {
  const cells: { parents: (readonly [number | null, number[]])[] }[] = [];
  const halve = (x: number, y: number, width: number, height: number): TableRegion => {
    const from = cells.length;
    if (width * height <= 4) {
      for (let i = x; i < x + width; i++)
        for (let j = y; j < y + height; j++)
          cells.push({ parents: [[rank, [10 * i, 10 * j, 0, 10 * i + 10, 10 * j + 10, 1]]] });
      return { from, to: cells.length, pages: [] };
    }
    const pages =
      width >= height
        ? [halve(x, y, width / 2, height), halve(x + width / 2, y, width / 2, height)]
        : [halve(x, y, width, height / 2), halve(x, y + height / 2, width, height / 2)];
    return { from, to: cells.length, pages };
  };
  const regions = [halve(0, 0, side, side)];
  return { cells, regions };
}

const indexed = (side: number) => {
  const { cells, regions } = world(side);
  const boxes = createCellBoxes([], new Group(), []);
  boxes.refresh();
  return createCellIndex(regions, cells, boxes);
};

test("a frame's cell work is the same on a world sixteen times as large", () => {
  // The same camera, 25 m from the corner cell of both worlds: 8 × 8 cells, then 32 × 32.
  const eye = [45, 45, 0.5];
  const found = (side: number) => {
    const cells: number[] = [];
    const tested = indexed(side).near(eye, 25, (cell) => cells.push(cell));
    return { tested, found: cells.length };
  };
  const small = found(8),
    large = found(32);
  assert.deepEqual(large.found, small.found, 'the same cells within reach');
  assert.equal(large.tested.cells, small.tested.cells, 'the same cells tested');
  // The pages opened grow by the levels the larger world adds, never by its cells.
  assert.ok(large.tested.pages <= small.tested.pages + 2 * 4, JSON.stringify([small, large]));
  assert.ok(large.tested.cells < (32 * 32) / 8, `${large.tested.cells} of ${32 * 32} cells tested`);
});

test('the index finds every cell a whole walk finds, under a parent moved and turned', () => {
  const { cells, regions } = world(16, 0);
  const root = new Group(),
    core = new Object3D();
  root.add(core);
  const boxes = createCellBoxes([0], root, [core]);
  const index = createCellIndex(regions, cells, boxes);
  const poses = [
    () => {},
    () => core.position.set(-70, 30, 0),
    () => core.rotation.set(0, 0, 0.7),
    () => core.scale.set(0.5, 2, 1),
  ];
  for (const pose of poses) {
    pose();
    boxes.refresh();
    for (const [x, y, radius] of [
      [0, 0, 15],
      [60, -40, 40],
      [-30, 90, 5],
    ]) {
      const eye = [x, y, 0.5];
      const found: number[] = [];
      index.near(eye, radius, (cell) => found.push(cell));
      const all = cells.map((_, cell) => cell);
      const walked = all.filter((cell) => index.distance(cell, eye) <= radius);
      assert.deepEqual(
        found.sort((a, b) => a - b),
        walked,
        `eye ${eye}, reach ${radius}`,
      );
      // The distance is the one of the cell's box where its parent stands now.
      for (const cell of found) assert.ok(index.distance(cell, eye) <= radius);
    }
  }
});
