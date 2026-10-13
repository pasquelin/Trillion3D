import type { TilePlace } from './tiles.ts'
import { PLACE_AXIS_BITS, PLACE_LAYER_BITS, TILES_PER_LAYER, TILES_PER_ROW } from './tiles.ts'

/** The place a table word names, read back field by field. */
export const entryPlace = (word: number): TilePlace => ({
  x: word & ((1 << PLACE_AXIS_BITS) - 1),
  y: (word >>> PLACE_AXIS_BITS) & ((1 << PLACE_AXIS_BITS) - 1),
  layer: (word >>> (2 * PLACE_AXIS_BITS)) & ((1 << PLACE_LAYER_BITS) - 1),
})

/** Rank of a place in the pool, layer by layer, row by row. */
export const placeIndex = (p: TilePlace) => p.layer * TILES_PER_LAYER + p.y * TILES_PER_ROW + p.x
