import type { TileKey } from './pageTable.ts'

/** Integer id of a streamed tile, the one the pool keeps per slot. */
export const tileId = ({ slot, level, tx, ty }: TileKey) =>
  ((slot << 20) | (level << 16) | (ty << 8) | tx) >>> 0
/** The slot and the level of a streamed tile's id. */
export const tileSlotOf = (id: number) => id >>> 20
const tileLevelOf = (id: number) => (id >>> 16) & 15
/** The key of a streamed tile's id, written into `key` when given. */
export function tileKeyOf(id: number, key: TileKey = { slot: 0, level: 0, tx: 0, ty: 0 }) {
  key.slot = tileSlotOf(id)
  key.level = tileLevelOf(id)
  key.ty = (id >>> 8) & 255
  key.tx = id & 255
  return key
}
/** Id of a texture's queue: outside the streamed-tile range. */
export const tailId = (slot: number) => (0x80000000 | slot) >>> 0
export const tailSlotOf = (id: number) => (id & 0x80000000 ? id & 0x7fffffff : undefined)
