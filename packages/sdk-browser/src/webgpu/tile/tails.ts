import type { TilePlace } from '../../texture/tiles.ts'
import type { PoolEncoding } from '../../texture/blockFormats.ts'
import type { TileTexture } from './tileTexture.ts'
import type { WebgpuTilePageTable } from './pageTable.ts'
import type { WebgpuTilePool } from './pool.ts'
import type { Lane } from './lanes.ts'
import { writeRgbaLevel, writeTail } from './write.ts'
import { writeBlocksLevel } from './writeBlocks.ts'
import { tailId } from './ids.ts'

/** Fills a tail's pinned place `place` of `pool`. */
export type TailWrite = (pool: WebgpuTilePool, place: TilePlace) => void

/**
 * THE ONE TAIL PIN of an atlas: a texture's tail takes a place of its lane's pool for good, held by
 * its key with the tiles (`Lane.resident`), `write` fills it and the table names it. The floor
 * holds every tail (`texturePoolFor`): a pool drawn under it refuses by name. At prepare every
 * tail in bytes or a host's is pinned (`pinTails`); a level files' tail waits for its levels and is
 * pinned by its asker (`fileTails.ts`); the white fill, until a map opens its lane, takes no place
 * and reads the white stand-in.
 */
export function createTailPins(atlas: {
  textures: readonly TileTexture[]
  encoding: PoolEncoding
  laneOf: (slot: number) => Lane
  pages: () => WebgpuTilePageTable
  fillWaits: () => boolean
}) {
  const { textures, encoding } = atlas
  const pinTail = (slot: number, write: TailWrite) => {
    const lane = atlas.laneOf(slot),
      id = tailId(slot)
    const index = lane.pool.acquire(id, true)
    if (index === undefined) throw new Error('TEXTURE_POOL_UNDER_FLOOR')
    lane.resident.set(id, index)
    const place = lane.pool.placeOf(index)
    write(lane.pool, place)
    atlas.pages().setTail(slot, place, encoding.tapOf(textures[slot].lane))
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
      const { layout, source, lane, retired } = textures[slot]
      if (retired || source.kind === 'files') continue
      if (slot === 0 && atlas.fillWaits()) {
        atlas.pages().setTail(0, { x: 0, y: 0, layer: 0 }, encoding.tapOf(lane))
        continue
      }
      const bytes = source.kind === 'host' ? undefined : encoding.tailOf(source.tail, lane)
      pinTail(slot, (pool, place) => {
        if (!bytes) return fromHost(slot, place)
        const write = lane === 'lossless' ? writeRgbaLevel : writeBlocksLevel
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
