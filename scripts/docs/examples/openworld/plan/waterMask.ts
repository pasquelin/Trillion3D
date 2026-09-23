/**
 * The cells of the erosion's working grid under the plan's water (#332): inside a lake's shore,
 * or within half a river's width of its course — and at least half a cell's diagonal, so the
 * channel is a chain of cells touching edge to edge and the water it gathers runs on to the sea.
 */
import type { Waters } from './erosion.ts';
import { WORLD } from './contract.ts';

const HALF = WORLD.size / 2;

/** 1 for each cell of a `side`² grid of `cell` metres (row-major) that lies under water. */
export function waterMask({ lakes, rivers }: Waters, side: number, cell: number): Uint8Array {
  const mask = new Uint8Array(side * side),
    mark = (
      minX: number,
      maxX: number,
      minZ: number,
      maxZ: number,
      inside: (x: number, z: number) => boolean,
    ) => {
      const index = (v: number) => Math.round((v + HALF) / cell),
        clamp = (i: number) => Math.max(0, Math.min(side - 1, i));
      for (let j = clamp(index(minZ)); j <= clamp(index(maxZ)); j++)
        for (let i = clamp(index(minX)); i <= clamp(index(maxX)); i++)
          if (inside(i * cell - HALF, j * cell - HALF)) mask[j * side + i] = 1;
    };
  for (const { x, z, radius } of lakes)
    mark(
      x - radius,
      x + radius,
      z - radius,
      z + radius,
      (px, pz) => Math.hypot(px - x, pz - z) <= radius,
    );
  for (const { river } of rivers)
    for (let k = 0; k + 1 < river.points.length; k++) {
      const [ax, , az] = river.points[k],
        [bx, , bz] = river.points[k + 1],
        reach = Math.max(river.widths[k] / 2, (cell * Math.SQRT2) / 2),
        length2 = (bx - ax) ** 2 + (bz - az) ** 2;
      mark(
        Math.min(ax, bx) - reach,
        Math.max(ax, bx) + reach,
        Math.min(az, bz) - reach,
        Math.max(az, bz) + reach,
        (px, pz) => {
          const t = Math.max(
            0,
            Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / length2),
          );
          return Math.hypot(px - ax - t * (bx - ax), pz - az - t * (bz - az)) <= reach;
        },
      );
    }
  return mask;
}
