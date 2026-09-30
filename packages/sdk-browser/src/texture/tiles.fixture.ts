import type { TilePlace } from './tiles.ts';
import { TILES_PER_LAYER } from './tiles.ts';

export const entryPlace = (word: number): TilePlace => ({
  x: word & 0xff,
  y: (word >>> 8) & 0xff,
  layer: (word >>> 16) & 0xff,
});

/** The pool's row width in tiles: a layer is square. */
const TILES_PER_ROW = Math.sqrt(TILES_PER_LAYER);

/** Rank of a place in the pool, layer by layer, row by row. */
export const placeIndex = (p: TilePlace) => p.layer * TILES_PER_LAYER + p.y * TILES_PER_ROW + p.x;
