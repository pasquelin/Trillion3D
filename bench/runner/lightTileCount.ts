// Light iterations per covered pixel of the tile pass's opaque lists (#924, OMB-03). Each tile's
// bounds come from the oracle of the pass (`gpuLightTileColumnOracle.ts`, the shader's port in
// f32), so the lists counted are those the engine builds, before and after the frustum planes.
import { LIGHT_SETTINGS } from '../../packages/sdk-core/src/index.ts';
import {
  sliceHits,
  sphereTouchesBox,
  tileBounds,
  toTileFrame,
  type TileView,
} from '../oracles/browser/gpuLightTileColumnOracle.ts';
import { pixelPoint } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import type { Light } from './lightTileCity.ts';

const SIZE = LIGHT_SETTINGS.tileSize;

/**
 * One tile's opaque list, the sun included (it is in every list): `before` the box alone — the
 * test develop ran before #924 —, `after` the box and the six planes of the tile's frustum,
 * `reach` the lights whose range sphere holds at least one covered pixel, the only lights whose
 * term is not an exact zero there. `missed` counts lights in `reach` but not in `after`: 0 when
 * the lists stay image-exact. `null` for a tile with no covered pixel, which the resolve skips.
 */
export function countTile(
  view: TileView,
  tile: [number, number],
  depths: Float32Array,
  lights: Light[],
) {
  const pixels: [number, number, number][] = [];
  for (let y = tile[1] * SIZE; y < Math.min((tile[1] + 1) * SIZE, view.height); y++)
    for (let x = tile[0] * SIZE; x < Math.min((tile[0] + 1) * SIZE, view.width); x++) {
      const z = depths[y * view.width + x];
      if (z > 0) pixels.push([x, y, z]);
    }
  if (!pixels.length) return null;
  const seen = pixels.map((p) => p[2]);
  const bounds = tileBounds(view, tile, Math.max(...seen), Math.min(...seen));
  const { lo, hi } = bounds.opaqueBox,
    origin = view.origin;
  let points: number[][] | undefined;
  const count = { covered: pixels.length, before: 1, after: 1, reach: 1, missed: 0 };
  for (const { centre, radius } of lights) {
    // A light well clear of the box is out of both lists: skipped before any allocation.
    let gap = 0;
    for (let a = 0; a < 3; a++) {
      const c = centre[a] - origin[a],
        g = Math.max(lo[a] - c, c - hi[a], 0);
      gap += g * g;
    }
    if (gap > (radius * 1.001 + 1e-3) ** 2) continue;
    const at = toTileFrame(view, centre);
    const before = sphereTouchesBox(bounds.opaqueBox, at, radius);
    const after = sliceHits(bounds, at, radius).opaque;
    // The box holds every covered pixel: a light out of it reaches none.
    const reach =
      before &&
      (points ??= pixels.map(([x, y, z]) => pixelPoint(view, x, y, z))).some(
        (p) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]) < radius,
      );
    count.before += +before;
    count.after += +after;
    count.reach += +reach;
    count.missed += +(reach && !after);
  }
  return count;
}

/** A list's cost in iterations per pixel: its length where the resolve walks it, every light of
 *  the scene where it walks them all. */
export type ListRule = (kept: number) => number;
/** The audit's rule, develop's before #849: past `tileLights`, the tile walks every light. */
export const walkAllPastList =
  (sceneLights: number): ListRule =>
  (kept) =>
    kept > LIGHT_SETTINGS.tileLights ? sceneLights : kept;
/** Develop's since #849: past its list, the tile's own slice in the pool (pool with room). */
export const walkPool: ListRule = (kept) => kept;

/**
 * Every tile of `view`: the covered pixels, and the light iterations summed over them — each
 * covered pixel walks its tile's opaque list once — under the box before and the planes after.
 * `perCoveredPixel` divides by the covered pixels, `perPixel` by every pixel of the image.
 */
export function countView(view: TileView, depths: Float32Array, lights: Light[]) {
  const sceneLights = lights.length + 1;
  const rules = { beforeAllPastList: walkAllPastList(sceneLights), pool: walkPool };
  const sums = { beforeAllPastList: 0, before: 0, after: 0, reach: 0 };
  let covered = 0,
    tiles = 0,
    missed = 0,
    overflowing = 0;
  for (let ty = 0; ty < Math.ceil(view.height / SIZE); ty++)
    for (let tx = 0; tx < Math.ceil(view.width / SIZE); tx++) {
      const tile = countTile(view, [tx, ty], depths, lights);
      if (!tile) continue;
      tiles++;
      covered += tile.covered;
      missed += tile.missed;
      overflowing += +(tile.before > LIGHT_SETTINGS.tileLights);
      sums.beforeAllPastList += tile.covered * rules.beforeAllPastList(tile.before);
      sums.before += tile.covered * rules.pool(tile.before);
      sums.after += tile.covered * rules.pool(tile.after);
      sums.reach += tile.covered * tile.reach;
    }
  const pixels = view.width * view.height;
  const per = (divisor: number) =>
    Object.fromEntries(
      Object.entries(sums).map(([key, sum]) => [key, covered ? sum / divisor : 0]),
    ) as typeof sums;
  return {
    pixels,
    covered,
    coverage: covered / pixels,
    tiles,
    overflowingTilesBefore: overflowing,
    missed,
    perCoveredPixel: per(covered),
    perPixel: per(pixels),
  };
}
