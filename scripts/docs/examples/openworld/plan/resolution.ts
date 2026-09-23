/**
 * How the terrain's share of the cache splits between triangles and baked ground textures
 * (#332). Both errors are lengths on the ground, in metres, so they are compared in one unit: a
 * triangle mesh misses the relief by up to its error threshold, and an image misplaces a colour
 * by up to half its texel. The split keeps the larger of the two as small as it can be; a
 * texture side is a multiple of four, so its BC7 blocks need no padding. No weight bridges them.
 */
import { COOK_COST, WORLD } from './contract.ts';
import { textureBytes } from './budget.ts';

export type TerrainSplit = {
  /** Texels along a baked tile's side. */
  size: number;
  /** Triangles the geometry may hold, flat parts included. */
  triangles: number;
  /** Published bytes of every baked texture together, bound. */
  textureBytes: number;
};

const LARGEST = 4096;

/**
 * The split of `bytes` over `textured` baked tiles, `flat` fixed triangles and the ground a
 * threshold keeps (`threshold(triangles)`, the histogram's answer).
 */
export function splitTerrain(
  bytes: number,
  textured: number,
  flat: number,
  threshold: (triangles: number) => number,
): TerrainSplit {
  let best: (TerrainSplit & { error: number }) | null = null;
  for (let size = 4; size <= LARGEST; size += 4) {
    const images = textured * textureBytes(size),
      triangles = Math.floor((bytes - images) / COOK_COST.bytesPerTriangle);
    if (triangles <= flat) break;
    const error = Math.max(threshold(triangles - flat), WORLD.tile / (size - 1) / 2);
    if (!best || error < best.error) best = { size, triangles, textureBytes: images, error };
  }
  if (!best) throw new Error('the terrain share cannot hold its fixed triangles');
  const { error: _, ...split } = best;
  return split;
}
