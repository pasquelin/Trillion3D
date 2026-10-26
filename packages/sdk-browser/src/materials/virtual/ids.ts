import type { TileKey } from './page/pageTable.ts'

/** Integer id of a streamed tile, the one the pool keeps per slot. */
export const tileId = ({ slot, level, tx, ty }: TileKey) =>
  ((slot << 20) | (level << 16) | (ty << 8) | tx) >>> 0
/** The slot of a streamed tile's id. */
export const tileSlotOf = (id: number) => id >>> 20
/** The level of a streamed tile's id. */
export const tileLevelOf = (id: number) => (id >>> 16) & 15
/** The key of a streamed tile's id, written into `key` when given. */
export function tileKeyOf(id: number, key: TileKey = { slot: 0, level: 0, tx: 0, ty: 0 }) {
  key.slot = tileSlotOf(id)
  key.level = tileLevelOf(id)
  key.ty = (id >>> 8) & 255
  key.tx = id & 255
  return key
}
/** The bit that makes an id a texture's queue, outside the streamed-tile range. */
const TAIL_FLAG = 0x80000000
/** Id of a texture's queue: outside the streamed-tile range. */
export const tailId = (slot: number) => (TAIL_FLAG | slot) >>> 0
/** Whether `id` is a texture's queue (`tailId`), not a streamed tile. */
export const isTailId = (id: number) => (id & TAIL_FLAG) !== 0
export const tailSlotOf = (id: number) => (isTailId(id) ? id & ~TAIL_FLAG : undefined)
/** The slot of the texture an id of the pool belongs to, a tail's or a streamed tile's. */
export const ownerSlotOf = (id: number) => tailSlotOf(id) ?? tileSlotOf(id)
/** Slots a tile id can name below a tail id's flag bit (`tileId` packs the slot from bit 20). */
export const MAX_TILE_SLOTS = 2048
/** The key of a tile or a slot in the atlas of `kind`: the colour atlas's id doubled, the data
 *  atlas's one past it. Tile ids and slots are keys of separate maps, never of one. */
export const atlasKeyOf = (kind: 'color' | 'data', id: number) =>
  id * 2 + (kind === 'color' ? 0 : 1)
