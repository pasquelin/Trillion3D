import type { TilePlace } from '../../texture/tiles.ts'
import type { LaneCounts, PoolLane } from '../../texture/blockFormats.ts'
import type { TileTexture } from './tileTexture.ts'
import type { WebgpuTilePool } from './pool.ts'
import type { TileKey, WebgpuTilePageTable } from './pageTable.ts'
import type { TileSlotUse } from './slotUse.ts'
import type { TailWrite } from './tails.ts'

export type WebgpuTileAtlas = {
  readonly kind: 'color' | 'data'
  /** The pools of the lanes that have one. */
  readonly pools: readonly WebgpuTilePool[]
  /** One view per lane, `PREVIEW_LAYOUT_NAMES` order, a stand-in where the lane has no pool; a new tuple
   *  whenever a pool is replaced, so a bind group keyed on it is rebuilt. */
  readonly views: readonly GPUTextureView[]
  readonly pages: WebgpuTilePageTable
  /** Its places' GPU words: when each was last read, and its tier (`slotUse.ts`). */
  readonly slotUse: TileSlotUse
  readonly textures: readonly TileTexture[]
  readonly evictions: number
  readonly refused: number
  poolOf(slot: number): WebgpuTilePool
  /** Tiles the pool of `lane` holds, none when the lane has no pool. */
  residentIn(lane: PoolLane): number
  /** Pins `slot`'s tail in a place of its lane's pool for good, `write` filling it (`tails.ts`). */
  pinTail(slot: number, write: TailWrite): void
  /** Pins the tail of each texture from slot `from` on; `fromHost` sets that of a texture with no
   *  tail in bytes. */
  pinTails(
    queue: GPUQueue,
    fromHost: (slot: number, place: TilePlace) => void,
    from?: number,
    to?: number,
  ): void
  /** Takes a texture after open, its lane's pool already sized for its tail (`resize`): its slot
   *  in a regrown table (`relayout`), its tail to pin (`pinTails`). Returns its slot. */
  append(texture: TileTexture): number
  release(slot: number): void
  /** Lays the table out again at `feedbackOffset` (`regrownPageTable`), the views a new tuple:
   *  every group naming the atlas is rebuilt once. */
  relayout(feedbackOffset: number): void
  /** Whether the tile resides. Its use is the GPU's: the pixels that read it stamp its place. */
  resides(key: TileKey): boolean
  /** Whether `slot`'s tail holds its place. */
  tailPinned(slot: number): boolean
  /** Whether the tile of id `id` resides; one that does is pinned or unpinned
   *  (`WebgpuTilePool.pin`): an asker that needs it and may read none of it — a card's maps — keeps
   *  it from the queue while it holds it. */
  pin(id: number, pinned: boolean): boolean
  /** A place for an arriving tile: free, or the next victim of its lane's queue (`placeOrder.ts`);
   *  `undefined` when the queue has none — every place read of late — refusal counted. */
  place(key: TileKey): TilePlace | undefined
  /** Says whether `place` may have a place to give, without taking anything; false counts a
   *  refusal. Residency is decided BEFORE reading a level: a pool full for the view launches no
   *  read for a tile it would then refuse. */
  roomFor(slot: number): boolean
  /** Level that serves a tile today: its own, an ancestor, or the tail. */
  servedLevel(key: TileKey): number
  /** Sends the table's changed words and the places' that arrived or left. */
  flush(device: Pick<GPUDevice, 'queue'>): void
  /** Changes each lane's layers while keeping its tiles; returns the evicted tiles and how many
   *  pools were replaced. */
  resize(device: GPUDevice, layers: LaneCounts): { evicted: number; replaced: number }
  destroy(): void
}
