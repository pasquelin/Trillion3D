import { createWebgpuTilePool, type WebgpuTilePool } from './pool.ts'
import { NO_VICTIMS, type VictimQueue } from './victimHeap.ts'
import type { WebgpuTilePageTable } from './pageTable.ts'
import {
  POOL_LANES,
  type LaneCounts,
  type PoolEncoding,
  type PoolLane,
} from '../../texture/blockFormats.ts'
import { resizeTileAtlas } from './atlasResize.ts'

/** A lane's pool, the tiles resident in it by id, and its eviction victims of the image. */
export type Lane = { pool: WebgpuTilePool; resident: Map<number, number>; victims: VictimQueue }

/**
 * The pools of an atlas, one per lane its textures take: the lossless RGBA8 lane, the RGBA block
 * lane, the two-channel one. A lane with no layer has no pool and an opaque-white stand-in view at
 * its binding — only the white fill of an atlas with no map reads it (`atlas.ts`), where every tap
 * of the fill's one texel read white. Each pool is sized by
 * the layers the budget gave its lane, never below the tails of its textures (`texturePoolFor`),
 * and resized on its own.
 */
export function createTileLanes(
  device: Pick<GPUDevice, 'createTexture' | 'queue'>,
  options: {
    kind: 'color' | 'data'
    encoding: PoolEncoding
    /** Layers of each lane's pool; a lane no texture takes has none, and no pool. */
    layers: LaneCounts
    textures: readonly { lane: PoolLane }[]
    /** A tile a resize gave up: its texture. */
    onEvicted?: (slot: number) => void
  },
) {
  const { kind, encoding, textures } = options
  const shape = (lane: PoolLane, layers: number) => ({
    kind,
    lane,
    format: encoding.formatOf(kind, lane),
    texelBytes: encoding.texelBytes(lane),
    layers,
  })
  const lanes = new Map<PoolLane, Lane>()
  const open = (lane: PoolLane, layers: number) =>
    lanes.set(lane, {
      pool: createWebgpuTilePool(device, shape(lane, layers)),
      resident: new Map(),
      victims: NO_VICTIMS,
    })
  for (const lane of POOL_LANES) if (options.layers[lane] > 0) open(lane, options.layers[lane])
  const standInTexture = device.createTexture({
    label: `Trillion3D texture pool ${kind} stand-in`,
    size: { width: 4, height: 4, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const white = new Uint8Array(4 * 4 * 4).fill(255)
  device.queue.writeTexture({ texture: standInTexture }, white, { bytesPerRow: 16 }, [4, 4])
  const standIn = standInTexture.createView({ dimension: '2d-array' })
  const views = () => POOL_LANES.map((lane) => lanes.get(lane)?.pool.view ?? standIn)
  const pools = () => [...lanes.values()].map((lane) => lane.pool)
  return {
    lanes,
    pools,
    of(slot: number) {
      const lane = lanes.get(textures[slot].lane)
      if (!lane) throw new Error(`TEXTURE_POOL_LANE ${textures[slot].lane}`)
      return lane
    },
    views,
    /** Every lane whose layers change gets a new pool that keeps its tiles, a lane that had none
     *  its first — a texture appended after open took it; returns the evicted tiles and how many
     *  pools were replaced — none when the layers are those already held. */
    resize(
      target: Pick<GPUDevice, 'createTexture' | 'createCommandEncoder' | 'queue'>,
      layers: LaneCounts,
      pages: WebgpuTilePageTable,
    ) {
      let evicted = 0,
        replaced = 0
      for (const name of POOL_LANES)
        if (!lanes.has(name) && layers[name] > 0) {
          open(name, layers[name])
          replaced++
        }
      for (const [name, lane] of lanes) {
        if (layers[name] === lane.pool.layers) continue
        replaced++
        if (layers[name] === 0 && lane.pool.resident === 0) {
          lane.pool.destroy()
          lanes.delete(name)
          continue
        }
        const result = resizeTileAtlas(
          target,
          shape(name, layers[name]),
          encoding.tapOf(name),
          lane.pool,
          pages,
          lane.resident,
          options.onEvicted,
        )
        lane.pool = result.pool
        evicted += result.evicted
      }
      return { evicted, replaced }
    },
    destroy() {
      for (const lane of lanes.values()) lane.pool.destroy()
      standInTexture.destroy()
    },
  }
}
