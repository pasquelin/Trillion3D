import { arrayView } from '../../gpu/core/textureViews.ts'
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
import type { ChangedRuns } from '../residency/ranges.ts'
import { acquire, adopt, occupied, placesOf, release, taken, use } from './poolPlaces.ts'
import { createPlaceOrder } from './placeOrder.ts'

/**
 * Physical pool of an atlas: an array-texture of 30×30-tile layers, at the size the host budget
 * gives — never at that of the scene. What a scene asks beyond that waits for a less-looked-at
 * tile to free. A budget change replaces the pool with another (`atlasResize.ts`),
 * which takes its places back through `adopt`.
 *
 * The pool does not know what a tile carries: it holds, per place, a KEY the caller confides to
 * it and whether it is pinned. A texture's tail is pinned at prepare; a streamed tile never is.
 * Which place gives itself up is the GPU's word: each frame stamps the places its pixels read, and
 * the pool's queue, ranked on those stamps, is read back with the feedback (`placeOrder.ts`). The
 * places occupied or freed since the last flush are `changed`: their use words follow
 * (`slotUse.ts`).
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
  /** Tiles that ever arrived or were used (`use`): the cut of a queue, a tile arrived or used
   *  since never its victim. */
  readonly arrivals: number
  /** Places occupied or freed since their use words were last written (`slotUse.ts`). */
  readonly changed: ChangedRuns
  /** Takes a free tile for `key`, or returns `undefined` when the pool is full. */
  acquire(key: number, pinned?: boolean): number | undefined
  /** Sets `key` at a precise free place — what a resized pool takes back from the old one. */
  adopt(index: number, key: number, pinned?: boolean): void
  release(index: number): void
  /** Stamps `index` used as an arrival is (`poolPlaces.ts`): what the CPU asks of a tile no pixel
   *  reads yet, in the same words the GPU stamps. */
  use(index: number): void
  keyOf(index: number): number
  pinnedOf(index: number): boolean
  /** Whether `index` is free. */
  freeAt(index: number): boolean
  /** The place the GPU's queue gives up next (`placeOrder.ts`): unpinned, and read by no pixel in
   *  the frame its queue was cut nor the one before. A tile looked at on the previous image is very
   *  likely looked at on this one: giving it up for another is asking for it again on the next — a
   *  full pool would spin on itself every image. It refuses instead, and the coarse level holds. */
  victim(): number | undefined
  /** How many victims the queue may still give: an upper bound. */
  victims(): number
  /** A place's rank in the queue, the first victim at 0; `undefined` unlisted. */
  rankOf(index: number): number | undefined
  /** Takes the queue a readback brought: its count then its places, cut at `arrivals`. */
  follow(queue: Uint32Array, arrivals: number): void
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
  const order = createPlaceOrder((index) =>
    places.owner[index] === -1 ? undefined : { index, generation: places.arrived[index] },
  )
  return {
    label,
    texture,
    view: arrayView(texture),
    layers,
    tiles,
    bytes: layers * poolLayerBytes(texelBytes),
    tileBytes: perTile,
    get resident() {
      return places.count
    },
    get residentBytes() {
      return places.count * perTile
    },
    get arrivals() {
      return places.arrivals
    },
    changed: places.changed,
    acquire: (key, pin = false) => acquire(places, key, pin),
    adopt: (index, key, pin = false) => adopt(places, index, key, pin),
    release: (index) => release(places, index),
    use: (index) => use(places, index),
    keyOf: (index) => places.owner[taken(places, index)],
    pinnedOf: (index) => places.pinned[taken(places, index)] === 1,
    freeAt: (index) => places.owner[index] === -1,
    victim: order.victim,
    victims: order.victims,
    rankOf: order.rankOf,
    follow: order.follow,
    occupied: () => occupied(places),
    placeOf,
    destroy() {
      texture.destroy()
    },
  }
}
