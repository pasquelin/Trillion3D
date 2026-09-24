import {
  placeOf,
  poolLayerBytes,
  POOL_LAYER_SIDE,
  tileBytes,
  TILES_PER_LAYER,
  type TilePlace,
} from '../../texture/tiles.ts';
import type { PoolLane } from '../../texture/blockFormats.ts';

/**
 * Physical pool of an atlas: an array-texture of 30×30-tile layers, at the size the host budget
 * gives — never at that of the scene. What a scene asks beyond that waits for a less-looked-at
 * tile to free. A budget change replaces the pool with another (`atlasResize.ts`),
 * which takes its places back through `adopt`.
 *
 * The pool does not know what a tile carries: it holds, per place, a KEY the caller confides to
 * it, the last image that looked at it, and whether it is pinned. A texture's tail is pinned at
 * prepare; a streamed tile never is.
 */
export type WebgpuTilePool = {
  /** Its texture's label as the engine wrote it, before a session's tag. */
  label: string;
  texture: GPUTexture;
  view: GPUTextureView;
  layers: number;
  /** Tiles the pool can carry, and allocated bytes — fixed as long as this pool lives — with
   *  what one tile costs in this pool's format. */
  tiles: number;
  bytes: number;
  tileBytes: number;
  /** Occupied tiles, and their bytes. */
  readonly resident: number;
  readonly residentBytes: number;
  /** Takes a free tile for `key`, or returns `undefined` when the pool is full. */
  acquire(key: number, frame: number, pinned?: boolean): number | undefined;
  /** Sets `key` at a precise free place — what a resized pool takes back from the old one. */
  adopt(index: number, key: number, frame: number, pinned?: boolean): void;
  release(index: number): void;
  touch(index: number, frame: number): void;
  keyOf(index: number): number;
  lastUseOf(index: number): number;
  pinnedOf(index: number): boolean;
  /** Unpinned tiles that neither `frame` nor the previous image looked at, least recently looked
   *  at first. A tile looked at on the previous image is very likely looked at on this one: giving
   *  it up for another is asking for it again on the next — a full pool would spin on itself every
   *  image. It refuses instead, and the coarse level holds; that is the age rule of the
   *  reference's virtual-texture pool. */
  candidates(frame: number): number[];
  /** Every occupied place, pinned included, in pool order. */
  occupied(): number[];
  placeOf(index: number): TilePlace;
  destroy(): void;
};

export type TilePoolDevice = Pick<GPUDevice, 'createTexture'>;

/** A pool's shape: its atlas and lane, its format, what a texel costs in it, and its layers. */
export type TilePoolOptions = {
  kind: 'color' | 'data';
  lane: PoolLane;
  format: GPUTextureFormat;
  texelBytes: number;
  layers: number;
};

export function createWebgpuTilePool(
  device: TilePoolDevice,
  options: TilePoolOptions,
): WebgpuTilePool {
  const { layers, format, texelBytes } = options;
  if (!Number.isSafeInteger(layers) || layers < 1) throw new Error('TEXTURE_POOL_LAYERS');
  const tiles = layers * TILES_PER_LAYER;
  const perTile = tileBytes(texelBytes);
  // `copyExternalImageToTexture` also requires `RENDER_ATTACHMENT` of its destination; a block
  // format cannot be one, and no browser image is ever copied into it.
  const attachment = texelBytes === 1 ? 0 : GPUTextureUsage.RENDER_ATTACHMENT;
  const label = `Trillion3D texture pool ${options.kind} ${options.lane}`;
  const texture = device.createTexture({
    label,
    size: { width: POOL_LAYER_SIDE, height: POOL_LAYER_SIDE, depthOrArrayLayers: layers },
    format,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      attachment,
  });
  const owner = new Int32Array(tiles).fill(-1),
    lastUse = new Uint32Array(tiles),
    pinned = new Uint8Array(tiles);
  // Free places, the lowest on top of the stack: a half-empty pool stays compact. The stack is
  // rebuilt in one pass when an adopt has stale-dated it, at the next take.
  const free: number[] = [];
  let freeStale = true,
    resident = 0;
  const settle = () => {
    if (!freeStale) return;
    free.length = 0;
    for (let index = tiles - 1; index >= 0; index--) if (owner[index] === -1) free.push(index);
    freeStale = false;
  };
  const check = (index: number) => {
    if (owner[index] === -1) throw new Error('TEXTURE_TILE_FREE');
  };
  const occupy = (index: number, key: number, frame: number, pin: boolean) => {
    owner[index] = key;
    lastUse[index] = frame;
    pinned[index] = pin ? 1 : 0;
    resident++;
  };
  return {
    label,
    texture,
    view: texture.createView({ dimension: '2d-array' }),
    layers,
    tiles,
    bytes: layers * poolLayerBytes(texelBytes),
    tileBytes: perTile,
    get resident() {
      return resident;
    },
    get residentBytes() {
      return resident * perTile;
    },
    acquire(key, frame, pin = false) {
      settle();
      const index = free.pop();
      if (index === undefined) return undefined;
      occupy(index, key, frame, pin);
      return index;
    },
    adopt(index, key, frame, pin = false) {
      if (owner[index] !== -1) throw new Error('TEXTURE_TILE_OCCUPIED');
      occupy(index, key, frame, pin);
      freeStale = true;
    },
    release(index) {
      check(index);
      owner[index] = -1;
      pinned[index] = 0;
      resident--;
      if (!freeStale) free.push(index);
    },
    touch(index, frame) {
      check(index);
      lastUse[index] = frame;
    },
    keyOf(index) {
      check(index);
      return owner[index];
    },
    lastUseOf(index) {
      check(index);
      return lastUse[index];
    },
    pinnedOf(index) {
      check(index);
      return pinned[index] === 1;
    },
    candidates(frame) {
      const out: number[] = [];
      for (let index = 0; index < tiles; index++)
        if (owner[index] !== -1 && !pinned[index] && lastUse[index] < frame - 1) out.push(index);
      return out.sort((a, b) => lastUse[a] - lastUse[b] || a - b);
    },
    occupied() {
      const out: number[] = [];
      for (let index = 0; index < tiles; index++) if (owner[index] !== -1) out.push(index);
      return out;
    },
    placeOf,
    destroy() {
      texture.destroy();
    },
  };
}
