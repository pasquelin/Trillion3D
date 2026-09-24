/**
 * The physics heights beside the cache (#332): one `heights/<tx>_<tz>.bin` per tile, Float32,
 * (samples + 1)² values row-major from the tile's −X, −Z corner, as `WorldRuntimeData` states.
 * They are `plan.height` at the same world coordinates the terrain mesh samples, so the ground
 * the player stands on is the ground the page draws, and two tiles share their border rows.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORLD, type WorldPlan } from './contract.ts';
import { tileOrigin, TILE_GRID } from './tileGrid.ts';

/**
 * Samples per tile side: 64, a height every 15.6 m, every other vertex of the mesh's finest
 * grid; a character or a wheel samples it bilinearly between them.
 */
export const HEIGHT_SAMPLES = (TILE_GRID - 1) / 2;
const TILES = WORLD.size / WORLD.tile;

/** One tile's heights, `(samples + 1)²` Float32 values, row-major from the −X, −Z corner. */
export function tileHeights(
  plan: Pick<WorldPlan, 'height'>,
  tx: number,
  tz: number,
  samples = HEIGHT_SAMPLES,
) {
  const side = samples + 1,
    step = WORLD.tile / samples,
    x0 = tileOrigin(tx),
    z0 = tileOrigin(tz),
    out = new Float32Array(side * side);
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) out[j * side + i] = plan.height(x0 + i * step, z0 + j * step);
  return out;
}

/** Writes every tile's heights under `dir/heights/`; returns the number of files written. */
export async function writeHeights(
  dir: string,
  plan: Pick<WorldPlan, 'height'>,
  samples = HEIGHT_SAMPLES,
) {
  const folder = join(dir, 'heights');
  await mkdir(folder, { recursive: true });
  for (let tz = 0; tz < TILES; tz++)
    await Promise.all(
      Array.from({ length: TILES }, (_, tx) => {
        const heights = tileHeights(plan, tx, tz, samples);
        return writeFile(join(folder, `${tx}_${tz}.bin`), new Uint8Array(heights.buffer));
      }),
    );
  return TILES * TILES;
}
