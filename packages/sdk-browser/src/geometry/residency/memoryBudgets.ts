import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import {
  poolLayerBytes,
  poolLayerLimit,
  tileBytes,
  TILES_PER_LAYER,
} from '../../materials/texture/tiles.ts'
import {
  laneCounts,
  POOL_LANES,
  type AtlasLanes,
  type BlockChoice,
  type LaneCounts,
  type PoolEncoding,
  type PoolLane,
} from '../../materials/texture/blockFormats.ts'
import { checkTexturePoolBudget, type PoolClamp } from '../../session/memory/pools.ts'
import type { Refusal } from '../../gpu/core/refusal.ts'

/** The texture pool as it stands: budget and bytes held. */ export type TexturePool = {
  /** Bytes allowed. */ budgetBytes: number
  /** Layers of each lane pool, per atlas, and the bytes of every pool added up. */
  layers: AtlasLanes
  /** Bytes held. */ allocatedBytes: number
  /** Why the size was limited. */ clamp: PoolClamp
}

/**
 * What prepare settles once, with the sidecar's chains and the catalogue in hand: the family the
 * session samples, its encoding, and the lane pools on the lanes' demand; `poolFor` draws the
 * same pools for another budget (`setMemoryBudgets`), or as far as `held` lays them
 * (`texturePoolFor`). Setup holds only the budget until then.
 */
export type TexturePools = {
  choice: BlockChoice
  encoding: PoolEncoding
  pool: TexturePool
  poolFor(budgetBytes: number, held?: AtlasLanes): TexturePool
  /** The pool's growth under way, one at a time (`followTexturePressure`). */
  growing?: Promise<unknown>
  /** The last growth the device or the budget refused, which the next waits for. */
  refusal?: Refusal
  /** What `poolFor` draws the lanes on — tiles and tails each lane's textures take —, grown in
   *  place by a texture appended after open. */
  demand: AtlasLanes
  tails: AtlasLanes
  /** Bytes held beside the pool it was drawn without: the live textures' working textures
   *  (`textureBytesBeside`). */
  liveBytes?: number
}

/** The pool layers `tiles` tiles fill. */
const layersFor = (tiles: number) => ceilDiv(tiles, TILES_PER_LAYER)
/** A lane's floor: its tails, and one tile to stream into when the lane streams. */
const laneFloor = (tails: number, streams: boolean) => layersFor(tails + Number(streams))

/** What the layers of an atlas are drawn from: the budget, the device's limit, the clamps said,
 *  and the bytes of a texel of each lane. */
type AtlasDraw = {
  budgetBytes: number
  limit: number
  clamps: Set<PoolClamp>
  texelBytes: (lane: PoolLane) => number
}

const layerBytesOf = (d: AtlasDraw, lane: PoolLane) => poolLayerBytes(d.texelBytes(lane))

/** The remainder of `budget` shared by weight among the lanes still `open`; a lane served under its
 *  share gives the rest back to the others. */
function shareRemainder(
  d: AtlasDraw,
  lanes: LaneCounts,
  layers: LaneCounts,
  floor: LaneCounts,
  open: Set<PoolLane>,
  budgetLeft: number,
) {
  let budget = budgetLeft
  for (let round = 0; open.size && round < POOL_LANES.length; round++) {
    const weight = (lane: PoolLane) => lanes[lane] * tileBytes(d.texelBytes(lane))
    const total = [...open].reduce((sum, lane) => sum + weight(lane), 0)
    const share = (lane: PoolLane) =>
      Math.floor((budget * weight(lane)) / total / layerBytesOf(d, lane))
    const capped = [...open].filter((lane) => share(lane) >= layersFor(lanes[lane]) - floor[lane])
    if (!capped.length) {
      for (const lane of open) layers[lane] += share(lane)
      break
    }
    for (const lane of capped) {
      layers[lane] = layersFor(lanes[lane])
      budget -= (layers[lane] - floor[lane]) * layerBytesOf(d, lane)
      open.delete(lane)
    }
    if (!open.size) d.clamps.add('scene')
  }
}

/** The device refuses only tails it cannot hold: the slot to stream into gives way to its limit. */
function limitLayers(d: AtlasDraw, layers: LaneCounts, kept: LaneCounts) {
  for (const lane of POOL_LANES)
    if (layers[lane] > d.limit) {
      if (d.limit < Math.max(1, layersFor(kept[lane])))
        throw new Error(
          `TEXTURE_POOL_DEVICE_LIMIT: ${kept[lane]} ${lane} tails, device allows ${d.limit} layers`,
        )
      layers[lane] = d.limit
      d.clamps.add('device-limit')
    }
}

/** The layers of each lane of one atlas whose lanes would hold `lanes` tiles and `kept` tails,
 *  within half the budget, no more than `holds` when given. */
function atlasLayers(d: AtlasDraw, lanes: LaneCounts, kept: LaneCounts, holds?: LaneCounts) {
  const layers = laneCounts()
  const open = new Set(POOL_LANES.filter((lane) => lanes[lane] > 0))
  // The tails, and one slot to stream into when the lane streams: never frozen at its tails.
  for (const lane of open) layers[lane] = laneFloor(kept[lane], lanes[lane] > kept[lane])
  const floor = { ...layers }
  let budget =
    d.budgetBytes / 2 -
    [...open].reduce((sum, lane) => sum + floor[lane] * layerBytesOf(d, lane), 0)
  if (budget < 0) {
    d.clamps.add('minimum')
    budget = 0
  }
  // The remainder by weight; a lane served under its share gives the rest back to the others.
  shareRemainder(d, lanes, layers, floor, open, budget)
  limitLayers(d, layers, kept)
  // What the lane holds already, no more: the rest of its share is room to grow into.
  if (holds)
    for (const lane of POOL_LANES) layers[lane] = clamp(holds[lane], floor[lane], layers[lane])
  return layers
}

/**
 * Layers of each lane pool that the texture-pool budget yields: half the budget per atlas; in an
 * atlas every lane that has textures gets its floor — the layers the tails of its textures take,
 * one tile each, kept resident whole (`tails`), as the geometry pool holds its root cover, plus
 * one tile to stream into when the lane has streamed tiles —, then the rest in proportion to the
 * bytes its textures would take resident, a block texel costing a quarter of an RGBA8 one, and
 * never more layers than its tiles need, what a capped lane leaves going to the others (`scene`
 * when every lane is served under the budget). A lane no texture takes has no layer. A budget
 * under the floor is raised to it, by name (`minimum`); above the layer count the device accepts —
 * within what a table entry addresses (`poolLayerLimit`) —, a lane is brought back to that limit,
 * by name. Only the device limit can refuse, when even the tails do not fit
 * (`TEXTURE_POOL_DEVICE_LIMIT`).
 *
 * The budget is room, not bytes taken: given `held`, the layers each lane holds already, the pool
 * is drawn only as far as they reach — a lane that holds none, at its floor — within the share
 * above, which is what it may grow to (`followTexturePressure`); its `clamp` is the share's.
 * Without `held` the pool is the whole share.
 */
export function texturePoolFor(
  budgetBytes: number,
  device: { limits?: { maxTextureArrayLayers?: number } } | undefined,
  /** Tiles each lane's textures would hold at full residency — tails and streamed entries. */
  demand: AtlasLanes,
  texelBytes: (lane: PoolLane) => number,
  /** Textures each lane holds: one tail each, never evicted. */
  tails: AtlasLanes,
  /** Layers each lane holds already, the pool drawn no further than they reach. */
  held?: AtlasLanes,
): TexturePool {
  checkTexturePoolBudget(budgetBytes)
  const draw: AtlasDraw = {
    budgetBytes,
    limit: poolLayerLimit(device?.limits),
    clamps: new Set<PoolClamp>(),
    texelBytes,
  }
  const layers = {
    color: atlasLayers(draw, demand.color, tails.color, held?.color),
    data: atlasLayers(draw, demand.data, tails.data, held?.data),
  }
  const allocatedBytes = [layers.color, layers.data].reduce(
    (bytes, lanes) =>
      bytes + POOL_LANES.reduce((sum, lane) => sum + lanes[lane] * layerBytesOf(draw, lane), 0),
    0,
  )
  const reason =
    (['device-limit', 'minimum', 'scene'] as const).find((name) => draw.clamps.has(name)) ?? null
  return { budgetBytes, layers, allocatedBytes, clamp: reason }
}

/** A lane about to take one more texture: its atlas, its tiles held — tails and streamed —, its
 *  textures' tails and whether any streams, the latter two with the new texture counted. */
export type LaneTaking = {
  kind: 'color' | 'data'
  lane: PoolLane
  resident: number
  tails: number
  streams: boolean
}

/**
 * The pool a live atlas takes one more texture in, after open: its lane grown only by the
 * layers the texture's tail needs — a free place beside every tile the lane holds, so nothing drawn
 * is evicted, and the floor `texturePoolFor` keeps, its tails and one tile to stream into —, every
 * other lane as it is; the same pool when the lane has room. A growth that takes the pool past
 * `budgetBytes` — what the budget leaves it beside the live textures (`budgetBeside`) —, or the
 * lane past the device's layers, is refused by name (`TEXTURE_BUDGET`): nothing is drawn for it.
 */
export function poolTaking(
  pool: TexturePool,
  taking: LaneTaking,
  layerBytes: number,
  limits: { budgetBytes: number; maxLayers: number },
): TexturePool {
  const { kind, lane } = taking
  const current = pool.layers[kind][lane]
  const wanted = Math.max(
    current,
    layersFor(taking.resident + 1),
    laneFloor(taking.tails, taking.streams),
  )
  if (wanted === current) return pool
  const allocatedBytes = pool.allocatedBytes + (wanted - current) * layerBytes
  if (allocatedBytes > limits.budgetBytes || wanted > limits.maxLayers)
    throw new EngineError('TEXTURE_BUDGET', 'the texture does not fit the texture budget', {
      ...taking,
      layers: wanted,
      askedBytes: allocatedBytes,
      ...limits,
    })
  const layers = { ...pool.layers, [kind]: { ...pool.layers[kind], [lane]: wanted } }
  return { ...pool, layers, allocatedBytes }
}
