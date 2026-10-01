import assert from 'node:assert/strict';
import { createBounceCascades, type BounceCascades } from './cascades.ts';
import { createBounceOccupancy, type BounceOccupancy } from './occupancy.ts';
import { BOUNCE_SETTINGS } from './contracts.ts';
import { ownedProxy } from '../scene/core/proxy.fixture.ts';

export type Box = readonly number[];

/** A proxy of `boxes` (low and high corners, one triangle spanning each) over `bounds`. */
export function scene(bounds: number[], boxes: Box[]) {
  const proxy = ownedProxy();
  proxy.bounds = bounds;
  // A triangle from the box's low corner to its high corner, and back, covers the box.
  proxy.data.triangles = new Float32Array(
    boxes.flatMap((box) => [...box.slice(0, 3), ...box.slice(3), ...box.slice(0, 3)]),
  );
  const cascades = createBounceCascades(bounds);
  return { proxy, cascades, occupancy: createBounceOccupancy(proxy, cascades) };
}

export const point = (at: number[]): Box => [...at, ...at];

/** Every cell of a level from `margin` cells before the bounds to `margin` cells after them. */
export function cellsAround(
  cascades: BounceCascades,
  level: number,
  bounds: readonly number[],
  margin = 4,
) {
  const spacing = cascades.levels[Math.min(level, cascades.levels.length - 1)].spacing;
  const low = [0, 1, 2].map((axis) => Math.floor(bounds[axis] / spacing) - margin);
  const high = [0, 1, 2].map((axis) => Math.floor(bounds[3 + axis] / spacing) + margin);
  const cells: number[][] = [];
  for (let z = low[2]; z <= high[2]; z++)
    for (let y = low[1]; y <= high[1]; y++)
      for (let x = low[0]; x <= high[0]; x++) cells.push([x, y, z]);
  return { cells, spacing };
}

/** Cells between a cell and the nearest cell a box touches, along the farthest axis. */
export function gap(cell: number[], box: Box, spacing: number) {
  let far = 0;
  for (let axis = 0; axis < 3; axis++) {
    const low = Math.floor(box[axis] / spacing),
      high = Math.floor(box[3 + axis] / spacing);
    far = Math.max(far, low - cell[axis], cell[axis] - high);
  }
  return far;
}

export const occupiedAt = (occupancy: BounceOccupancy, level: number, cell: number[]) =>
  occupancy.occupied(level, cell[0], cell[1], cell[2]);

/** The cells at most one cell away from each of `cells`, on every axis. */
function around(cells: Iterable<number[]>) {
  const out = new Map<string, number[]>();
  for (const [x, y, z] of cells)
    for (let k = 0; k < 27; k++) {
      const cell = [x + (k % 3) - 1, y + (Math.floor(k / 3) % 3) - 1, z + Math.floor(k / 9) - 1];
      out.set(`${cell}`, cell);
    }
  return out;
}

/**
 * The published map of `boxes`: the finest level holds every cell a box touches and the cells
 * around it, nothing else. A coarser level holds the cells around the parent of each cell held
 * below it, and nothing else, but where the map ends; never a probe that interpolates the boxes
 * (`assertInterpolated`).
 */
export function assertMap(
  occupancy: BounceOccupancy,
  cascades: BounceCascades,
  bounds: readonly number[],
  boxes: Box[],
  label: string,
) {
  const wrong: string[] = [];
  let held = 0;
  let expected = new Map<string, number[]>();
  cascades.levels.forEach((_, level) => {
    const { cells, spacing } = cellsAround(cascades, level, bounds);
    if (level)
      expected = around(
        [...expected.values()].map((cell) => cell.map((value) => Math.floor(value / 2))),
      );
    for (const cell of cells) {
      const occupied = occupiedAt(occupancy, level, cell);
      if (level === 0) {
        const near = boxes.some((box) => gap(cell, box, spacing) <= 1);
        if (near) expected.set(`${cell}`, cell);
        if (occupied) held++;
        if (occupied !== near) wrong.push(`${level}: ${cell}`);
      } else if (occupied && !expected.has(`${cell}`)) wrong.push(`${level}: ${cell}`);
    }
  });
  assert.equal(occupancy.marked, held, `${label}: marked`);
  assert.deepEqual(wrong.slice(0, 8), [], `${label}: ${wrong.length} cells wrong`);
  assertInterpolated(occupancy, cascades, boxes, label);
}

/** Asserts the eight probes around each box corner, offset along any axis, are kept at every level. */
function assertInterpolated(
  occupancy: BounceOccupancy,
  cascades: BounceCascades,
  boxes: Box[],
  label: string,
) {
  const bias = BOUNCE_SETTINGS.normalBias;
  cascades.levels.forEach(({ spacing }, level) => {
    for (const box of boxes)
      for (const corner of [box.slice(0, 3), box.slice(3)])
        for (const offset of [-bias, 0, bias])
          for (let axis = 0; axis < 3; axis++) {
            const at = corner.slice();
            at[axis] += offset * spacing;
            const first = at.map((value) => Math.floor(value / spacing - 0.5));
            for (let probe = 0; probe < 8; probe++) {
              const cell = first.map((value, k) => value + ((probe >> k) & 1));
              assert.ok(
                occupiedAt(occupancy, level, cell),
                `${label}: level ${level} probe ${cell}`,
              );
            }
          }
  });
}
