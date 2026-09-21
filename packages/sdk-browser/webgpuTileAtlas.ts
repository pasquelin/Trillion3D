import type * as THREE from 'three';
import type { TextureRgba } from './visibilityTypes.ts';
import { entryLevel, type TileLayout, type TilePlace } from './textureTiles.ts';
import { createWebgpuTilePool, type WebgpuTilePool } from './webgpuTilePool.ts';
import {
  createWebgpuTilePageTable,
  type TileKey,
  type WebgpuTilePageTable,
} from './webgpuTilePageTable.ts';
import { writeTailFromBytes } from './webgpuTileWrite.ts';
import { resizeTileAtlas } from './webgpuTileAtlasResize.ts';
import { tailId, tileId, tileKeyOf } from './webgpuTileIds.ts';

/**
 * Where a texture's texels come from. `bytes`: everything fits in the sidecar tail, nothing is
 * streamed. `baked`: the tail comes from the sidecar, streamed levels are read cooked from the
 * cache. `host`: neither, the host image goes through a working texture.
 */
type TileSource =
  | { kind: 'bytes'; tail: readonly Uint8Array[] }
  | { kind: 'baked'; sha256: string; atlas: number; tail: readonly Uint8Array[] }
  | { kind: 'host'; map: THREE.Texture; rgba: TextureRgba | null };

export type TileTexture = { layout: TileLayout; source: TileSource };

/**
 * A virtual-texture atlas: its pool, its page table and its catalogue. It knows which tile
 * resides where, which to give its place up, and it keeps the table current; what a tile contains
 * and where that comes from is the streamer's business.
 */
export type WebgpuTileAtlas = {
  readonly kind: 'color' | 'data';
  readonly pool: WebgpuTilePool;
  readonly pages: WebgpuTilePageTable;
  readonly textures: readonly TileTexture[];
  readonly evictions: number;
  readonly refused: number;
  /** Pins the tail of each texture; `fromHost` sets that of a texture with no tail in bytes. */
  pinTails(queue: GPUQueue, fromHost: (slot: number, place: TilePlace) => void): void;
  /** Marks the tile seen if it resides; says whether that is so. */
  touch(key: TileKey, frame: number): boolean;
  /** A place for an arriving tile: free, or taken back from the least looked-at; `undefined`
   *  when everything the pool carries has been looked at in this image — refusal counted. */
  place(key: TileKey, frame: number): TilePlace | undefined;
  /** Says whether `place` would have a place to give in this image, without taking anything;
   *  false counts a refusal. Residency is decided BEFORE reading a level: a pool full for the
   *  view launches no read for a tile it would then refuse. */
  roomFor(frame: number): boolean;
  /** Level that serves a tile today: its own, an ancestor, or the tail. */
  servedLevel(key: TileKey): number;
  flush(device: Pick<GPUDevice, 'queue'>): void;
  /** Changes the layer pool while keeping its tiles; returns the count of evicted tiles. */
  resize(
    device: Pick<GPUDevice, 'createTexture' | 'createCommandEncoder' | 'queue'>,
    layers: number,
  ): number;
  destroy(): void;
};

export function createWebgpuTileAtlas(
  device: Pick<GPUDevice, 'createTexture' | 'createBuffer' | 'queue'>,
  options: {
    kind: 'color' | 'data';
    format: GPUTextureFormat;
    layers: number;
    feedbackOffset: number;
    textures: TileTexture[];
    /** A tile gave its place up: the texture it belonged to, for whoever reads it to follow. */
    onEvicted?: (slot: number) => void;
  },
): WebgpuTileAtlas {
  const { kind, textures } = options;
  let pool = createWebgpuTilePool(device, {
    kind,
    format: options.format,
    layers: options.layers,
  });
  const pages = createWebgpuTilePageTable(
    device,
    textures.map((texture) => texture.layout),
    { kind, feedbackOffset: options.feedbackOffset },
  );
  if (textures.length > pool.tiles)
    throw new Error(`TEXTURE_POOL_TAILS: ${textures.length} textures, ${pool.tiles} tiles`);
  const resident = new Map<number, number>();
  let evictions = 0,
    refused = 0;
  // Eviction candidates, computed once per image and consumed in order.
  let candidates: number[] = [],
    candidatesFrame = -1;
  const candidatesAt = (frame: number) => {
    if (candidatesFrame !== frame) {
      candidates = pool.candidates(frame);
      candidatesFrame = frame;
    }
    return candidates;
  };
  const evict = (frame: number) => {
    const index = candidatesAt(frame).shift();
    if (index === undefined) return undefined;
    const id = pool.keyOf(index),
      key = tileKeyOf(id);
    pages.clearTile(key);
    resident.delete(id);
    pool.release(index);
    evictions++;
    options.onEvicted?.(key.slot);
    return index;
  };
  return {
    kind,
    get pool() {
      return pool;
    },
    pages,
    textures,
    get evictions() {
      return evictions;
    },
    get refused() {
      return refused;
    },
    pinTails(queue, fromHost) {
      textures.forEach((texture, slot) => {
        const index = pool.acquire(tailId(slot), 0, true)!;
        const place = pool.placeOf(index);
        const { layout, source } = texture;
        if (source.kind === 'host') fromHost(slot, place);
        else
          writeTailFromBytes(
            queue,
            pool.texture,
            place,
            [layout.width, layout.height],
            layout.tail,
            source.tail,
          );
        pages.setTail(slot, place);
      });
    },
    touch(key, frame) {
      const index = resident.get(tileId(key));
      if (index === undefined) return false;
      pool.touch(index, frame);
      return true;
    },
    roomFor(frame) {
      if (pool.resident < pool.tiles || candidatesAt(frame).length > 0) return true;
      refused++;
      return false;
    },
    place(key, frame) {
      const id = tileId(key);
      // A free place, otherwise the one the least looked-at just gave back.
      let index = pool.acquire(id, frame);
      if (index === undefined && evict(frame) !== undefined) index = pool.acquire(id, frame);
      if (index === undefined) {
        refused++;
        return undefined;
      }
      resident.set(id, index);
      const place = pool.placeOf(index);
      pages.setTile(key, place);
      return place;
    },
    servedLevel(key) {
      const word = pages.entryOf(key);
      return word === 0 ? textures[key.slot].layout.tail : entryLevel(word);
    },
    flush: (target) => pages.flush(target),
    resize(target, layers) {
      const result = resizeTileAtlas(
        target,
        { kind, format: options.format, layers },
        pool,
        pages,
        resident,
      );
      pool = result.pool;
      evictions += result.evicted;
      candidatesFrame = -1;
      return result.evicted;
    },
    destroy() {
      pages.destroy();
      pool.destroy();
    },
  };
}
