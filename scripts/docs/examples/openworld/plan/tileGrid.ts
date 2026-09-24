/**
 * The height samples of one terrain tile (#332): a (2^k + 1)² grid from the tile's −X, −Z
 * corner, plus a one-sample apron so every vertex's normal is a central difference. Two tiles
 * sample their shared border at the same world coordinates through the same function, so they
 * hold the same heights and the same normals there. Heights are stored as Float32, the precision
 * the mesh and the physics files carry.
 */
import { WORLD } from './contract.ts';

/** Vertices along a tile side: 2^7 + 1, a vertex every 7.8 m at the finest. */
export const TILE_GRID = 129;
export const TILE_STEP = WORLD.tile / (TILE_GRID - 1);
const APRON = TILE_GRID + 2;

export const tileOrigin = (tile: number) => -WORLD.size / 2 + tile * WORLD.tile;

export class TileGrid {
  readonly x0: number;
  readonly z0: number;
  private readonly samples = new Float32Array(APRON * APRON).fill(Number.NaN);

  readonly tx: number;
  readonly tz: number;
  private readonly height: (x: number, z: number) => number;

  constructor(tx: number, tz: number, height: (x: number, z: number) => number) {
    this.tx = tx;
    this.tz = tz;
    this.height = height;
    this.x0 = tileOrigin(tx);
    this.z0 = tileOrigin(tz);
  }

  /** Samples every vertex and the apron now, rather than on demand. */
  fill(): this {
    for (let j = -1; j <= TILE_GRID; j++) for (let i = -1; i <= TILE_GRID; i++) this.at(i, j);
    return this;
  }

  /** Height at grid vertex (i, j); -1 and `TILE_GRID` reach into the apron. */
  at(i: number, j: number): number {
    const index = (j + 1) * APRON + i + 1;
    let value = this.samples[index];
    if (Number.isNaN(value)) {
      value = Math.fround(this.height(this.x0 + i * TILE_STEP, this.z0 + j * TILE_STEP));
      this.samples[index] = value;
    }
    return value;
  }

  /** Lowest height of the tile's vertices. */
  minimum(): number {
    let low = Infinity;
    for (let j = 0; j < TILE_GRID; j++)
      for (let i = 0; i < TILE_GRID; i++) low = Math.min(low, this.at(i, j));
    return low;
  }

  /** Height of a vertex by its index in the tile's grid. */
  vertex(index: number): number {
    const i = index % TILE_GRID;
    return this.at(i, (index - i) / TILE_GRID);
  }

  /** Unit normal at a vertex, from central differences over one grid step. */
  normal(index: number): [number, number, number] {
    const i = index % TILE_GRID,
      j = (index - i) / TILE_GRID,
      dx = (this.at(i + 1, j) - this.at(i - 1, j)) / (2 * TILE_STEP),
      dz = (this.at(i, j + 1) - this.at(i, j - 1)) / (2 * TILE_STEP),
      length = Math.hypot(dx, 1, dz);
    return [-dx / length, 1 / length, -dz / length];
  }
}
