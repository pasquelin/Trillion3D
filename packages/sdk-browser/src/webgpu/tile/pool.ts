import {
  placeOf,
  poolLayerBytes,
  POOL_LAYER_SIDE,
  POOL_MAX_LAYERS,
  tileBytes,
  TILES_PER_LAYER,
  type TilePlace,
} from '../../texture/tiles.ts'
import type { PoolLane } from '../../texture/blockFormats.ts'
import { createVictimHeap, type VictimQueue } from './victimHeap.ts'

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
  label: string
  texture: GPUTexture
  view: GPUTextureView
  layers: number
  /** Tiles the pool can carry, and allocated bytes — fixed as long as this pool lives — with
   *  what one tile costs in this pool's format. */
  tiles: number
  bytes: number
  tileBytes: number
  /** Occupied tiles, and their bytes. */
  readonly resident: number
  readonly residentBytes: number
  /** Takes a free tile for `key`, or returns `undefined` when the pool is full. */
  acquire(key: number, frame: number, pinned?: boolean): number | undefined
  /** Sets `key` at a precise free place — what a resized pool takes back from the old one. */
  adopt(index: number, key: number, frame: number, pinned?: boolean): void
  release(index: number): void
  touch(index: number, frame: number): void
  keyOf(index: number): number
  lastUseOf(index: number): number
  pinnedOf(index: number): boolean
  /** Unpinned tiles that neither `frame` nor the previous image looked at, least recently looked
   *  at first, as a queue built once per image. A tile looked at on the previous image is very
   *  likely looked at on this one: giving it up for another is asking for it again on the next — a
   *  full pool would spin on itself every image. It refuses instead, and the coarse level holds;
   *  that is the pool's age rule. */
  victims(frame: number): VictimQueue
  /** Every occupied place, pinned included, in pool order. */
  occupied(): number[]
  placeOf(index: number): TilePlace
  destroy(): void
}

export type TilePoolDevice = Pick<GPUDevice, 'createTexture'>

/** A pool's shape: its atlas and lane, its format, what a texel costs in it, and its layers. */
export type TilePoolOptions = {
  kind: 'color' | 'data'
  lane: PoolLane
  format: GPUTextureFormat
  texelBytes: number
  layers: number
}

/** The texture a pool of this shape holds: what the pool creates, and what a probe asks the device
 *  for before the pool is drawn (`../residency/poolGrants.ts`). Never more layers than a table
 *  entry addresses (`POOL_MAX_LAYERS`): a place past them would read another tile. */
export function tilePoolTexture(options: TilePoolOptions) {
  const { layers, format, texelBytes } = options
  if (!Number.isSafeInteger(layers) || layers < 1 || layers > POOL_MAX_LAYERS)
    throw new Error('TEXTURE_POOL_LAYERS')
  // `copyExternalImageToTexture` also requires `RENDER_ATTACHMENT` of its destination; a block
  // format cannot be one, and no browser image is ever copied into it.
  const attachment = texelBytes === 1 ? 0 : GPUTextureUsage.RENDER_ATTACHMENT
  return {
    label: `Trillion3D texture pool ${options.kind} ${options.lane}`,
    size: { width: POOL_LAYER_SIDE, height: POOL_LAYER_SIDE, depthOrArrayLayers: layers },
    format,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      attachment,
  }
}

/** What a pool knows of its places: per place, the key it holds — -1 free —, the last image that
 *  looked at it and whether it is pinned; the free places, and the image's eviction victims. */
type Places = {
  tiles: number
  owner: Int32Array
  lastUse: Uint32Array
  pinned: Uint8Array
  /** Free places, the lowest on top of the stack: a half-empty pool stays compact. The stack is
   *  rebuilt in one pass when an adopt has stale-dated it, at the next take. */
  free: number[]
  freeStale: boolean
  resident: number
  /** The image's eviction victims, ordered by last use then index, in one reused buffer. */
  heap: ReturnType<typeof createVictimHeap>
}

const placesOf = (tiles: number): Places => ({
  tiles,
  owner: new Int32Array(tiles).fill(-1),
  lastUse: new Uint32Array(tiles),
  pinned: new Uint8Array(tiles),
  free: [],
  freeStale: true,
  resident: 0,
  heap: createVictimHeap(tiles),
})

function settle(places: Places) {
  if (!places.freeStale) return
  const { free, owner } = places
  free.length = 0
  for (let index = places.tiles - 1; index >= 0; index--) if (owner[index] === -1) free.push(index)
  places.freeStale = false
}

/** `index`, held: a free place is refused. */
function taken({ owner }: Places, index: number) {
  if (owner[index] === -1) throw new Error('TEXTURE_TILE_FREE')
  return index
}

function occupy(places: Places, index: number, key: number, frame: number, pin: boolean) {
  places.owner[index] = key
  places.lastUse[index] = frame
  places.pinned[index] = pin ? 1 : 0
  places.resident++
}

function acquire(places: Places, key: number, frame: number, pin: boolean) {
  settle(places)
  const index = places.free.pop()
  if (index === undefined) return undefined
  occupy(places, index, key, frame, pin)
  return index
}

function adopt(places: Places, index: number, key: number, frame: number, pin: boolean) {
  if (places.owner[index] !== -1) throw new Error('TEXTURE_TILE_OCCUPIED')
  occupy(places, index, key, frame, pin)
  places.freeStale = true
}

function release(places: Places, index: number) {
  taken(places, index)
  places.owner[index] = -1
  places.pinned[index] = 0
  places.resident--
  if (!places.freeStale) places.free.push(index)
}

function victims({ tiles, owner, pinned, lastUse, heap }: Places, frame: number) {
  heap.clear()
  for (let index = 0; index < tiles; index++)
    if (owner[index] !== -1 && !pinned[index] && lastUse[index] < frame - 1)
      heap.add(lastUse[index], index)
  return heap.order()
}

function occupied({ tiles, owner }: Places) {
  const out: number[] = []
  for (let index = 0; index < tiles; index++) if (owner[index] !== -1) out.push(index)
  return out
}

export function createWebgpuTilePool(
  device: TilePoolDevice,
  options: TilePoolOptions,
): WebgpuTilePool {
  const descriptor = tilePoolTexture(options)
  const { layers, texelBytes } = options
  const tiles = layers * TILES_PER_LAYER
  const perTile = tileBytes(texelBytes)
  const label = descriptor.label
  const texture = device.createTexture(descriptor)
  const places = placesOf(tiles)
  return {
    label,
    texture,
    view: texture.createView({ dimension: '2d-array' }),
    layers,
    tiles,
    bytes: layers * poolLayerBytes(texelBytes),
    tileBytes: perTile,
    get resident() {
      return places.resident
    },
    get residentBytes() {
      return places.resident * perTile
    },
    acquire: (key, frame, pin = false) => acquire(places, key, frame, pin),
    adopt: (index, key, frame, pin = false) => adopt(places, index, key, frame, pin),
    release: (index) => release(places, index),
    touch(index, frame) {
      places.lastUse[taken(places, index)] = frame
    },
    keyOf: (index) => places.owner[taken(places, index)],
    lastUseOf: (index) => places.lastUse[taken(places, index)],
    pinnedOf: (index) => places.pinned[taken(places, index)] === 1,
    victims: (frame) => victims(places, frame),
    occupied: () => occupied(places),
    placeOf,
    destroy() {
      texture.destroy()
    },
  }
}
