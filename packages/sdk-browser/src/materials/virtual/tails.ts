import type { TilePlace } from '../texture/tiles.ts'
import type { PoolEncoding, PoolLane } from '../texture/blockFormats.ts'
import type { TileTexture } from './tileTexture.ts'
import type { WebgpuTilePageTable } from './page/pageTable.ts'
import type { WebgpuTilePool } from './pool/pool.ts'
import type { Lane } from './lanes.ts'
import { texelLevelWriter, writeTail } from './write.ts'
import { TEXEL_BYTES } from '../texture/floatTexels.ts'
import { writeBc4Level, writeBlocksLevel } from './writeBlocks.ts'
import { tailId } from './ids.ts'

/** Fills a tail's pinned place `place` of `pool`. */
export type TailWrite = (pool: WebgpuTilePool, place: TilePlace) => void

/** The writer of a tail's levels into a pool of `lane`: texels, or compressed blocks. */
function tailLevelWriter(encoding: PoolEncoding, lane: PoolLane) {
  const kind = encoding.texelsOf(lane)
  return lane === 'lossless'
    ? texelLevelWriter(4)
    : kind
      ? texelLevelWriter(TEXEL_BYTES[kind])
      : lane === 'two-channel' && encoding.channelPool === 'bc4'
        ? writeBc4Level
        : writeBlocksLevel
}

/**
 * THE ONE TAIL PIN of an atlas: a texture's tail takes a place of its lane's pool for good, held by
 * its key with the tiles (`Lane.resident`), `write` fills it and the table names it. The floor
 * holds every tail (`texturePoolFor`): a tail pinned late into a pool its streamed tiles fill takes
 * the place one of them gives up (`makeRoom`); only a pool drawn under the floor refuses by name.
 * At prepare every tail in bytes or a host's is pinned (`pinTails`); the white fill, until a map
 * opens its lane, takes no place and reads the white stand-in.
 */
export function createTailPins(atlas: {
  textures: readonly TileTexture[]
  encoding: PoolEncoding
  laneOf: (slot: number) => Lane
  pages: () => WebgpuTilePageTable
  fillWaits: () => boolean
  /** Gives up a streamed tile of the lane for a tail; whether one was. */
  makeRoom: (lane: Lane) => boolean
}) {
  const { textures, encoding } = atlas
  const pinTail = (slot: number, write: TailWrite) => {
    const lane = atlas.laneOf(slot),
      id = tailId(slot)
    const index =
      lane.pool.acquire(id) ?? (atlas.makeRoom(lane) ? lane.pool.acquire(id) : undefined)
    if (index === undefined) throw new Error('TEXTURE_POOL_UNDER_FLOOR')
    lane.resident.set(id, index)
    const place = lane.pool.placeOf(index)
    write(lane.pool, place)
    atlas.pages().setTail(slot, place, textures[slot].tap)
  }
  /** Pins the tails of slots `from` to `to`; `fromHost` sets that of a texture with no tail in
   *  bytes. */
  const pinTails = (
    queue: GPUQueue,
    fromHost: (slot: number, place: TilePlace) => void,
    from = 0,
    to = textures.length,
  ) => {
    for (let slot = from; slot < to; slot++) {
      const { layout, source, lane, tap, retired } = textures[slot]
      if (retired) continue
      if (slot === 0 && atlas.fillWaits()) {
        atlas.pages().setTail(0, { x: 0, y: 0, layer: 0 }, tap)
        continue
      }
      const bytes =
        source.kind === 'host'
          ? undefined
          : encoding.tailOf(source.tail, lane, {
              width: layout.width,
              height: layout.height,
              tail: layout.tail,
            })
      pinTail(slot, (pool, place) => {
        if (!bytes) return fromHost(slot, place)
        const write = tailLevelWriter(encoding, lane)
        const size: [number, number] = [layout.width, layout.height]
        writeTail(queue, pool.texture, place, size, layout.tail, bytes, write)
      })
    }
  }
  return {
    pinTail,
    pinTails,
    /** Whether `slot`'s tail holds its place. */
    tailPinned: (slot: number) => atlas.laneOf(slot).resident.has(tailId(slot)),
  }
}
