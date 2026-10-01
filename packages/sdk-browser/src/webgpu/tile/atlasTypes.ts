import type { TilePlace } from '../../texture/tiles.ts';
import type { LaneCounts, PoolLane } from '../../texture/blockFormats.ts';
import type { TileTexture } from './tileTexture.ts';
import type { WebgpuTilePool } from './pool.ts';
import type { TileKey, WebgpuTilePageTable } from './pageTable.ts';

export type WebgpuTileAtlas = {
  readonly kind: 'color' | 'data';
  /** The pools of the lanes that have one. */
  readonly pools: readonly WebgpuTilePool[];
  /** One view per lane, `POOL_LANES` order, a stand-in where the lane has no pool; a new tuple
   *  whenever a pool is replaced, so a bind group keyed on it is rebuilt. */
  readonly views: readonly GPUTextureView[];
  readonly pages: WebgpuTilePageTable;
  readonly textures: readonly TileTexture[];
  readonly evictions: number;
  readonly refused: number;
  poolOf(slot: number): WebgpuTilePool;
  /** Tiles the pool of `lane` holds, none when the lane has no pool. */
  residentIn(lane: PoolLane): number;
  /** Pins the tail of each texture from slot `from` on; `fromHost` sets that of a texture with no
   *  tail in bytes. */
  pinTails(
    queue: GPUQueue,
    fromHost: (slot: number, place: TilePlace) => void,
    from?: number,
    to?: number,
  ): void;
  /** Takes a texture after open, its lane's pool already sized for its tail (`resize`): its slot
   *  in a regrown table (`relayout`), its tail to pin (`pinTails`). Returns its slot. */
  append(texture: TileTexture): number;
  release(slot: number): void;
  /** Lays the table out again at `feedbackOffset` (`regrownPageTable`), the views a new tuple:
   *  every group naming the atlas is rebuilt once. */
  relayout(feedbackOffset: number): void;
  /** Marks the tile seen if it resides; says whether that is so. */
  touch(key: TileKey, frame: number): boolean;
  /** A place for an arriving tile: free, or taken back from the least looked-at of its lane;
   *  `undefined` when everything the pool carries has been looked at in this image — refusal counted. */
  place(key: TileKey, frame: number): TilePlace | undefined;
  /** Says whether `place` would have a place to give in this image, without taking anything;
   *  false counts a refusal. Residency is decided BEFORE reading a level: a pool full for the
   *  view launches no read for a tile it would then refuse. */
  roomFor(slot: number, frame: number): boolean;
  /** Level that serves a tile today: its own, an ancestor, or the tail. */
  servedLevel(key: TileKey): number;
  flush(device: Pick<GPUDevice, 'queue'>): void;
  /** Changes each lane's layers while keeping its tiles; returns the evicted tiles and how many
   *  pools were replaced. */
  resize(
    device: Pick<GPUDevice, 'createTexture' | 'createCommandEncoder' | 'queue'>,
    layers: LaneCounts,
  ): { evicted: number; replaced: number };
  destroy(): void;
};
