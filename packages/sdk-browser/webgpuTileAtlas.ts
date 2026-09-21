import type * as THREE from 'three';
import type { TextureRgba } from './visibilityTypes.ts';
import { entryLevel, type TileLayout, type TilePlace } from './textureTiles.ts';
import type { WebgpuTilePool } from './webgpuTilePool.ts';
import {
  createWebgpuTilePageTable,
  type TileKey,
  type WebgpuTilePageTable,
} from './webgpuTilePageTable.ts';
import { writeTailFromBytes } from './webgpuTileWrite.ts';
import { writeTailFromBlocks } from './webgpuTileWriteBlocks.ts';
import type { LaneCounts, PoolEncoding, PoolLane, TailBytes } from './textureBlockFormats.ts';
import { createTileLanes, type Lane } from './webgpuTileLanes.ts';
import { tailId, tileId, tileKeyOf } from './webgpuTileIds.ts';

/**
 * Where a texture's texels come from. `bytes`: everything fits in the sidecar tail, nothing is
 * streamed. `baked`: the tail comes from the sidecar, streamed levels are read cooked from the
 * cache. `host`: neither, the host image goes through a working texture. A tail carries every
 * encoding the sidecar holds; the atlas pins the one its lane samples.
 */
type TileSource =
  | { kind: 'bytes'; tail: TailBytes }
  | { kind: 'baked'; sha256: string; atlas: number; tail: TailBytes }
  | { kind: 'host'; map: THREE.Texture; rgba: TextureRgba | null };

/** A texture of the atlas: its tile geometry, the lane whose pool holds it, its texels. */
export type TileTexture = { layout: TileLayout; lane: PoolLane; source: TileSource };

/**
 * A virtual-texture atlas: one pool per lane, its page table and its catalogue. It knows which
 * tile resides where, which to give its place up, and it keeps the table current; what a tile
 * contains and where that comes from is the streamer's business. A texture's tiles and tail live
 * in the pool of its lane, and the shader reads the lane in the texture's header.
 */
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
  /** Pins the tail of each texture; `fromHost` sets that of a texture with no tail in bytes. */
  pinTails(queue: GPUQueue, fromHost: (slot: number, place: TilePlace) => void): void;
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

export function createWebgpuTileAtlas(
  device: Pick<GPUDevice, 'createTexture' | 'createBuffer' | 'queue'>,
  options: {
    kind: 'color' | 'data';
    encoding: PoolEncoding;
    layers: LaneCounts;
    feedbackOffset: number;
    textures: TileTexture[];
    /** A tile gave its place up: the texture it belonged to, for whoever reads it to follow. */
    onEvicted?: (slot: number) => void;
  },
): WebgpuTileAtlas {
  const { kind, textures, encoding } = options;
  const lanes = createTileLanes(device, options);
  let views = lanes.views(),
    pools = lanes.pools();
  const pages = createWebgpuTilePageTable(
    device,
    textures.map((texture) => texture.layout),
    { kind, feedbackOffset: options.feedbackOffset },
  );
  let evictions = 0,
    refused = 0,
    candidatesFrame = -1;
  // Eviction candidates, computed once per image and per lane, consumed in order.
  const candidatesAt = (lane: Lane, frame: number) => {
    if (candidatesFrame !== frame) {
      for (const each of lanes.lanes.values()) each.candidates = each.pool.candidates(frame);
      candidatesFrame = frame;
    }
    return lane.candidates;
  };
  const evict = (lane: Lane, frame: number) => {
    const index = candidatesAt(lane, frame).shift();
    if (index === undefined) return undefined;
    const id = lane.pool.keyOf(index),
      key = tileKeyOf(id);
    pages.clearTile(key);
    lane.resident.delete(id);
    lane.pool.release(index);
    evictions++;
    options.onEvicted?.(key.slot);
    return index;
  };
  return {
    kind,
    get pools() {
      return pools;
    },
    get views() {
      return views;
    },
    pages,
    textures,
    get evictions() {
      return evictions;
    },
    get refused() {
      return refused;
    },
    poolOf: (slot) => lanes.of(slot).pool,
    pinTails(queue, fromHost) {
      textures.forEach((texture, slot) => {
        const { layout, source, lane } = texture;
        const pool = lanes.of(slot).pool;
        const place = pool.placeOf(pool.acquire(tailId(slot), 0, true)!);
        if (source.kind === 'host') fromHost(slot, place);
        else
          (lane === 'lossless' ? writeTailFromBytes : writeTailFromBlocks)(
            queue,
            pool.texture,
            place,
            [layout.width, layout.height],
            layout.tail,
            encoding.tailOf(source.tail, lane),
          );
        pages.setTail(slot, place, encoding.tapOf(lane));
      });
    },
    touch(key, frame) {
      const lane = lanes.of(key.slot),
        index = lane.resident.get(tileId(key));
      if (index === undefined) return false;
      lane.pool.touch(index, frame);
      return true;
    },
    roomFor(slot, frame) {
      const lane = lanes.of(slot);
      if (lane.pool.resident < lane.pool.tiles || candidatesAt(lane, frame).length > 0) return true;
      refused++;
      return false;
    },
    place(key, frame) {
      const lane = lanes.of(key.slot),
        id = tileId(key);
      // A free place, otherwise the one the least looked-at just gave back.
      let index = lane.pool.acquire(id, frame);
      if (index === undefined && evict(lane, frame) !== undefined)
        index = lane.pool.acquire(id, frame);
      if (index === undefined) {
        refused++;
        return undefined;
      }
      lane.resident.set(id, index);
      const place = lane.pool.placeOf(index);
      pages.setTile(key, place);
      return place;
    },
    servedLevel(key) {
      const word = pages.entryOf(key);
      return word === 0 ? textures[key.slot].layout.tail : entryLevel(word);
    },
    flush: (target) => pages.flush(target),
    resize(target, layers) {
      const result = lanes.resize(target, layers, pages);
      if (result.replaced) {
        views = lanes.views();
        pools = lanes.pools();
      }
      evictions += result.evicted;
      candidatesFrame = -1;
      return result;
    },
    destroy() {
      pages.destroy();
      lanes.destroy();
    },
  };
}
