/**
 * Error thresholds of the terrain tiles (#332): the error histogram that says how many triangles
 * a threshold keeps, the exact count of a conforming network, and the border matching that makes
 * neighbouring tiles hold the same vertices.
 */
import { onBorder, propagate, type Hierarchy } from './rtin.ts';
import type { TileGrid } from './tileGrid.ts';
import { TILE_GRID } from './tileGrid.ts';

/** Log-scale bins of the error histogram: 64 per doubling, from 2^-16 to 2^16 metres. */
export const BINS_PER_OCTAVE = 64;
const LOW = -16;
const BINS = 32 * BINS_PER_OCTAVE;

export type Tile = { grid: TileGrid; errors: Float32Array | null; deep: boolean };

/**
 * The smallest threshold whose meshes, before borders are matched, fit a triangle budget: the
 * histogram is built once, then read for any budget.
 */
export function thresholdCurve(tiles: readonly Tile[]): (budget: number) => number {
  const histogram = new Float64Array(BINS);
  let base = 0;
  for (const tile of tiles) {
    base += 2;
    if (!tile.errors) continue;
    tile.errors.forEach((error, m) => {
      if (error <= 0) return;
      const bin = Math.min(
        BINS - 1,
        Math.max(0, Math.floor((Math.log2(error) - LOW) * BINS_PER_OCTAVE)),
      );
      histogram[bin] += onBorder(TILE_GRID, m) ? 1 : 2;
    });
  }
  return (budget) => {
    let total = base;
    for (let bin = BINS - 1; bin >= 0; bin--) {
      if (total + histogram[bin] > budget) return 2 ** (LOW + (bin + 1) / BINS_PER_OCTAVE);
      total += histogram[bin];
    }
    return 0;
  };
}

/** Triangles a conforming network holds at `threshold`: two, plus one per split per side. */
export function countTriangles(errors: Float32Array, threshold: number): number {
  let count = 2;
  errors.forEach((error, m) => {
    if (error > threshold) count += onBorder(TILE_GRID, m) ? 1 : 2;
  });
  return count;
}

/**
 * Error tables where each tile also splits the border vertices its neighbours split at
 * `threshold`, so both sides of every edge hold the same vertices. Splitting a border vertex
 * splits its ancestors, some on the tile's other borders, so matching repeats until no tile
 * changes. `null` stays for an untouched deep tile.
 */
export function conform(
  tiles: readonly Tile[],
  shape: Hierarchy,
  threshold: number,
  columns: number,
) {
  const last = TILE_GRID - 1,
    errors = tiles.map((tile) => tile.errors),
    owned = errors.map(() => false),
    active = (index: number, m: number) => (errors[index]?.[m] ?? 0) > threshold,
    west = (k: number) => k * TILE_GRID,
    east = (k: number) => k * TILE_GRID + last,
    north = (k: number) => k,
    south = (k: number) => last * TILE_GRID + k;
  for (let changed = true; changed;) {
    changed = false;
    errors.forEach((_, index) => {
      const column = index % columns,
        forced: number[] = [],
        // Each side: the neighbour across it, this tile's border vertex, the neighbour's twin.
        sides = [
          [column > 0 ? index - 1 : -1, west, east],
          [column < columns - 1 ? index + 1 : -1, east, west],
          [index - columns, north, south],
          [index + columns, south, north],
        ] as const;
      for (const [neighbour, own, theirs] of sides)
        if (neighbour >= 0 && neighbour < tiles.length)
          for (let k = 1; k < last; k++)
            if (active(neighbour, theirs(k)) && !active(index, own(k))) forced.push(own(k));
      if (!forced.length) return;
      if (!owned[index]) {
        const source = errors[index];
        errors[index] = source ? Float32Array.from(source) : new Float32Array(TILE_GRID ** 2);
        owned[index] = true;
      }
      for (const m of forced) errors[index]![m] = Infinity;
      propagate(shape, errors[index]!, null);
      changed = true;
    });
  }
  return errors;
}
