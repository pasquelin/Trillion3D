import { arrayView } from '../../gpu/core/textureViews.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { createWebgpuTilePool, type WebgpuTilePool } from './pool/pool.ts'
import type { WebgpuTilePageTable } from './page/pageTable.ts'
import {
  atlasLanes,
  type LaneCounts,
  type PoolEncoding,
  type PoolLane,
} from '../texture/blockFormats.ts'
import { resizeTileAtlas } from './atlas/atlasResize.ts'
import { retire } from '../../gpu/core/frameRetire.ts'

/** A lane's pool, and the places held in it by key: its tiles and its textures' tails. */
export type Lane = { pool: WebgpuTilePool; resident: Map<number, number> }

type TileLanesOptions = {
  kind: 'color' | 'data'
  encoding: PoolEncoding
  /** Layers of each lane's pool; a lane no texture takes has none, and no pool. */
  layers: LaneCounts
  textures: readonly { lane: PoolLane; tap: number }[]
}

/** The shape of the pool of `lane` at `layers` layers. */
const poolShape = (
  kind: 'color' | 'data',
  encoding: PoolEncoding,
  lane: PoolLane,
  layers: number,
) => ({
  kind,
  lane,
  format: encoding.formatOf(kind, lane),
  texelBytes: encoding.texelBytes(lane),
  layers,
})

/** Resizes the pool of lane `name` to `layers` layers, keeping its tiles; a lane that closes
 *  empty is retired. Returns the tiles evicted. */
function resizeLane(
  target: GPUDevice,
  lanes: Map<PoolLane, Lane>,
  name: PoolLane,
  lane: Lane,
  layers: number,
  context: {
    shape: ReturnType<typeof poolShape>
    options: TileLanesOptions
    pages: WebgpuTilePageTable
  },
) {
  if (layers === 0 && lane.pool.resident === 0) {
    // Groups this image encoded may still name its view: retired, as a replaced pool.
    retire(target, lane.pool)
    lanes.delete(name)
    return 0
  }
  const { options } = context
  const result = resizeTileAtlas(
    target,
    context.shape,
    (slot) => options.textures[slot].tap,
    lane.pool,
    context.pages,
    lane.resident,
  )
  lane.pool = result.pool
  return result.evicted
}

/**
 * The pools of an atlas, one per lane its textures take: the lossless RGBA8 lane, the RGBA block
 * lane, then the two-channel one — the data atlas's — or the half-float one — the colour atlas's
 * (`atlasLanes`). A lane with no layer has no pool and an opaque-white stand-in view at
 * its binding — only the white fill of an atlas with no map reads it (`atlas/atlas.ts`), where every tap
 * of the fill's one texel read white. Each pool is sized by
 * the layers the budget gave its lane, never below the tails of its textures (`texturePoolFor`),
 * and resized on its own.
 */
export function createTileLanes(
  device: Pick<GPUDevice, 'createTexture' | 'queue'>,
  options: TileLanesOptions,
) {
  const { kind, encoding, textures } = options
  const lanes = new Map<PoolLane, Lane>()
  const open = (lane: PoolLane, layers: number) =>
    lanes.set(lane, {
      pool: createWebgpuTilePool(device, poolShape(kind, encoding, lane, layers)),
      resident: new Map(),
    })
  const bound = atlasLanes(kind)
  for (const lane of bound) if (options.layers[lane] > 0) open(lane, options.layers[lane])
  const standInWhite = standInTexture(
    device,
    `Trillion3D texture pool ${kind} stand-in`,
    'rgba8unorm',
    {
      side: 4,
      fill: 255,
    },
  )
  const standIn = arrayView(standInWhite)
  const views = () => bound.map((lane) => lanes.get(lane)?.pool.view ?? standIn)
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
    resize(target: GPUDevice, layers: LaneCounts, pages: WebgpuTilePageTable) {
      let evicted = 0,
        replaced = 0
      for (const name of bound)
        if (!lanes.has(name) && layers[name] > 0) {
          open(name, layers[name])
          replaced++
        }
      for (const [name, lane] of lanes) {
        if (layers[name] === lane.pool.layers) continue
        replaced++
        const shape = poolShape(kind, encoding, name, layers[name])
        evicted += resizeLane(target, lanes, name, lane, layers[name], { shape, options, pages })
      }
      return { evicted, replaced }
    },
    destroy() {
      for (const lane of lanes.values()) lane.pool.destroy()
      standInWhite.destroy()
    },
  }
}
