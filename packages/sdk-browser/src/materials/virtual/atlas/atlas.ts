import { entryLevel } from '../../texture/tiles.ts'
import { createTileSlotUse } from '../slotUse.ts'
import type { TileTexture } from '../tileTexture.ts'
import { createWebgpuTilePageTable } from '../page/pageTable.ts'
import {
  atlasLanes,
  type LaneCounts,
  type PoolEncoding,
  type PoolLane,
} from '../../texture/blockFormats.ts'
import { createTileLanes, type Lane } from '../lanes.ts'
import { MAX_TILE_SLOTS, tileId, tileSlotOf } from '../ids.ts'
import { createTailPins } from '../tails.ts'
import { evictTile } from './atlasResize.ts'
import { releaseTileSlot } from '../release.ts'
import { regrownPageTable } from '../regrow.ts'
import type { TileKey } from '../page/pageTable.ts'
import type { WebgpuTileAtlas } from './atlasTypes.ts'

/** The lanes of an atlas that refused no arrival (`WebgpuTileAtlas.takePressure`). */
const NO_LANES: readonly PoolLane[] = []

type AtlasOptions = {
  kind: 'color' | 'data'
  encoding: PoolEncoding
  layers: LaneCounts
  feedbackOffset: number
  textures: TileTexture[]
  /** The clock the next feedback reduction stamps at: what an arrival is used at
   *  (`../slotUse.ts`). */
  clock: () => number
}

/** What an atlas holds and changes as it lives: the methods read and write it. */
type AtlasState = {
  device: GPUDevice
  options: AtlasOptions
  textures: TileTexture[]
  lanes: ReturnType<typeof createTileLanes>
  slotUse: ReturnType<typeof createTileSlotUse>
  vacant: Set<number>
  /** The lanes that refused an arrival since `takePressure` last read them. */
  pressed: Set<PoolLane>
  pages: ReturnType<typeof createWebgpuTilePageTable>
  views: ReturnType<ReturnType<typeof createTileLanes>['views']>
  pools: ReturnType<ReturnType<typeof createTileLanes>['pools']>
  evictions: number
  refused: number
}

const layoutOf = (texture: TileTexture) => texture.layout

const layoutsOf = (a: AtlasState) => a.textures.map(layoutOf)

const lanePoolsOf = (a: AtlasState) =>
  atlasLanes(a.options.kind).map((name) => a.lanes.lanes.get(name)?.pool)

function relayout(a: AtlasState, offset: number, replaced = -1) {
  const { kind } = a.options
  a.pages = regrownPageTable(
    a.device,
    a.pages,
    layoutsOf(a),
    { kind, feedbackOffset: offset },
    replaced,
  )
  a.views = a.lanes.views()
}

const refuse = (a: AtlasState, slot: number) => {
  a.refused++
  a.pressed.add(a.textures[slot].lane)
}

/** Gives up a streamed tile of `lane`: the GPU queue's victim. `forced`, for a tail the floor
 *  holds, when the queue refuses — every tile read of late —, the unpinned place it ranks first,
 *  any unpinned one past those it lists: the coarse level holds for it. */
function evict(a: AtlasState, lane: Lane, forced = false) {
  const { pool } = lane
  let index = pool.victim()
  if (index === undefined && forced) {
    for (const place of pool.occupied())
      if (
        !pool.pinnedOf(place) &&
        (index === undefined || pool.rankOrLast(place) < pool.rankOrLast(index))
      )
        index = place
  }
  if (index === undefined) return undefined
  evictTile(lane.pool, index, { pages: a.pages, resident: lane.resident })
  a.evictions++
  return index
}

/** The white fill never opens a lane (`laneDemand`): until a map opens its own, it takes no
 *  layer and reads the white stand-in (`../lanes.ts`). */
const fillWaits = (a: AtlasState) => !a.lanes.lanes.has(a.textures[0].lane)

/** The slots of an atlas: a texture taken after open, one released. */
function slotMethods(a: AtlasState) {
  return {
    append(texture: TileTexture) {
      const slot = a.vacant.values().next().value ?? a.textures.length
      if (slot >= MAX_TILE_SLOTS) throw new Error('TEXTURE_SLOTS_EXHAUSTED')
      const previous = a.textures[slot]
      a.textures[slot] = texture
      try {
        relayout(a, a.pages.words[0], slot)
      } catch (error) {
        if (previous) a.textures[slot] = previous
        else a.textures.pop()
        throw error
      }
      a.vacant.delete(slot)
      return slot
    },
    release(slot: number) {
      releaseTileSlot(a.lanes.of(slot), slot)
      a.vacant.add(slot)
      // Keep the layout until reuse: dropping allocates no GPU buffer and stale feedback
      // remains decodable, but retired slots are never served.
      a.textures[slot] = {
        ...a.textures[slot],
        texture: undefined,
        source: a.textures[0].source,
        retired: true,
      }
    },
  }
}

/** The tiles of an atlas: where one resides, the place for an arrival, the level that serves. */
function tileMethods(a: AtlasState) {
  return {
    resides: (key: TileKey) => a.lanes.of(key.slot).resident.has(tileId(key)),
    queued(id: number) {
      const lane = a.lanes.of(tileSlotOf(id)),
        index = lane.resident.get(id)
      return index !== undefined && lane.pool.rankOf(index) !== undefined
    },
    takePressure() {
      if (!a.pressed.size) return NO_LANES
      const taken = [...a.pressed]
      a.pressed.clear()
      return taken
    },
    roomFor(slot: number) {
      if (a.lanes.of(slot).pool.room() > 0) return true
      refuse(a, slot)
      return false
    },
    place(key: TileKey) {
      const lane = a.lanes.of(key.slot),
        id = tileId(key)
      // A free place, otherwise the one the GPU's queue gives back.
      let index = lane.pool.acquire(id)
      if (index === undefined && evict(a, lane) !== undefined) index = lane.pool.acquire(id)
      if (index === undefined) {
        refuse(a, key.slot)
        return undefined
      }
      lane.resident.set(id, index)
      const place = lane.pool.placeOf(index)
      a.pages.setTile(key, place)
      return place
    },
    servedLevel(key: TileKey) {
      const word = a.pages.entryOf(key)
      return word === 0 ? a.textures[key.slot].layout.tail : entryLevel(word)
    },
  }
}

/** The upkeep of an atlas: the flush, the resize of its lanes, the end. */
function upkeepMethods(a: AtlasState, tails: ReturnType<typeof createTailPins>) {
  return {
    flush(target: Pick<GPUDevice, 'queue'>) {
      a.pages.flush(target)
      a.slotUse.flush(a.options.clock())
    },
    resize(target: GPUDevice, layers: LaneCounts) {
      const { textures } = a
      const fillLane = a.lanes.lanes.get(textures[0].lane)
      // The fill follows its lane: its place given back as it closes, pinned as it opens or closes.
      if (fillLane && layers[textures[0].lane] === 0) releaseTileSlot(fillLane, 0)
      const waited = fillWaits(a),
        result = a.lanes.resize(target, layers, a.pages)
      if (waited !== fillWaits(a)) tails.pinTails(target.queue, () => {}, 0, 1)
      if (result.replaced) {
        a.views = a.lanes.views()
        a.pools = a.lanes.pools()
        a.slotUse.layout(lanePoolsOf(a))
      }
      a.evictions += result.evicted
      return result
    },
    destroy() {
      a.pages.destroy()
      a.slotUse.destroy()
      a.lanes.destroy()
    },
  }
}

/**
 * A virtual-texture atlas: one pool per lane, its page table and its catalogue. It knows which
 * tile resides where, which to give its place up, and it keeps the table current; what a tile
 * contains and where that comes from is the streamer's business. A texture's tiles and tail live
 * in the pool of its lane, and the shader reads the lane in the texture's header.
 */
export function createWebgpuTileAtlas(device: GPUDevice, options: AtlasOptions): WebgpuTileAtlas {
  const { kind, textures, encoding, feedbackOffset } = options
  if (textures.length > MAX_TILE_SLOTS) throw new Error('TEXTURE_SLOTS_EXHAUSTED')
  const lanes = createTileLanes(device, options)
  const slotUse = createTileSlotUse(device, kind)
  const a: AtlasState = {
    device,
    options,
    textures,
    lanes,
    slotUse,
    vacant: new Set(),
    pressed: new Set(),
    pages: createWebgpuTilePageTable(device, textures.map(layoutOf), { kind, feedbackOffset }),
    views: lanes.views(),
    pools: lanes.pools(),
    evictions: 0,
    refused: 0,
  }
  slotUse.layout(lanePoolsOf(a))
  const tails = createTailPins({
    textures,
    encoding,
    laneOf: lanes.of,
    pages: () => a.pages,
    fillWaits: () => fillWaits(a),
    makeRoom: (lane) => evict(a, lane, true) !== undefined,
  })
  return {
    kind,
    get pools() {
      return a.pools
    },
    get views() {
      return a.views
    },
    get pages() {
      return a.pages
    },
    slotUse,
    textures,
    get evictions() {
      return a.evictions
    },
    get refused() {
      return a.refused
    },
    poolOf: (slot) => lanes.of(slot).pool,
    residentIn: (lane) => lanes.lanes.get(lane)?.pool.resident ?? 0,
    pinTail: tails.pinTail,
    pinTails: tails.pinTails,
    tailPinned: tails.tailPinned,
    relayout: (offset) => relayout(a, offset),
    ...slotMethods(a),
    ...tileMethods(a),
    ...upkeepMethods(a, tails),
  }
}
