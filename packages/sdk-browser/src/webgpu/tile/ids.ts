import type { TileKey } from './pageTable.ts';

/** Integer id of a streamed tile, the one the pool keeps per slot. */
export const tileId = ({ slot, level, tx, ty }: TileKey) =>
  ((slot << 20) | (level << 16) | (ty << 8) | tx) >>> 0;
export const tileKeyOf = (id: number): TileKey => ({
  slot: id >>> 20,
  level: (id >>> 16) & 15,
  ty: (id >>> 8) & 255,
  tx: id & 255,
});
/** Id of a texture's queue: outside the streamed-tile range. */
export const tailId = (slot: number) => (0x80000000 | slot) >>> 0;
export const tailSlotOf = (id: number) => (id & 0x80000000 ? id & 0x7fffffff : undefined);
