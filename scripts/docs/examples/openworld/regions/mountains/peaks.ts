/**
 * The region's summits: local maxima of the plan's height on a coarse grid, each climbed to its
 * top by a shrinking hill-climb, highest first, kept apart so two tops of one mountain count once.
 */
import type { Vec3 } from '../../plan/contract.ts';
import type { Placer } from './space.ts';

const GRID = 250;
const APART = 1_500;

/** Climbs from (x, z) to the nearby top, in steps from `GRID / 2` down to 2 m. */
function climb(height: (x: number, z: number) => number, x: number, z: number): Vec3 {
  let best = height(x, z);
  for (let step = GRID / 2; step >= 2; step /= 2)
    for (let moved = true; moved;) {
      moved = false;
      for (const [dx, dz] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const h = height(x + dx, z + dz);
        if (h > best) [best, x, z, moved] = [h, x + dx, z + dz, true];
      }
    }
  return [x, best, z];
}

/** Summits on ground the region owns, highest first, at least `APART` from one another. */
export function summits(placer: Placer): Vec3[] {
  const { bounds, plan } = placer,
    columns = Math.floor((bounds.maxX - bounds.minX) / GRID),
    rows = Math.floor((bounds.maxZ - bounds.minZ) / GRID),
    at = (i: number, j: number) =>
      [bounds.minX + (i + 0.5) * GRID, bounds.minZ + (j + 0.5) * GRID] as const,
    grid = Array.from({ length: columns }, (_, i) =>
      Array.from({ length: rows }, (_, j) => plan.height(...at(i, j))),
    );
  const tops: Vec3[] = [];
  for (let i = 1; i + 1 < columns; i++)
    for (let j = 1; j + 1 < rows; j++) {
      const h = grid[i][j];
      let top = true;
      for (let di = -1; di <= 1 && top; di++)
        for (let dj = -1; dj <= 1; dj++) if ((di || dj) && grid[i + di][j + dj] >= h) top = false;
      if (!top) continue;
      const peak = climb(plan.height, ...at(i, j));
      if (placer.owns(peak[0], peak[2], 100)) tops.push(peak);
    }
  tops.sort((a, b) => b[1] - a[1]);
  const kept: Vec3[] = [];
  for (const top of tops)
    if (kept.every((k) => Math.hypot(k[0] - top[0], k[2] - top[2]) > APART)) kept.push(top);
  return kept;
}
