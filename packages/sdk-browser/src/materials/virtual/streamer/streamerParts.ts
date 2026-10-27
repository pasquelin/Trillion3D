import { createWebgpuTileAtlas } from '../atlas/atlas.ts'
import type { AtlasLanes, PoolEncoding } from '../../texture/blockFormats.ts'
import type { TileTexture } from '../tileTexture.ts'
import type { FrameClock } from '../../../geometry/integration/frameBudget.ts'
import type { WebgpuTileAtlas } from '../atlas/atlasTypes.ts'
import { createTileSources } from '../sources/sources.ts'
import type { createTileRequests } from '../requests.ts'
import { HEADERS_SWITCHED, HEADERS_WRITTEN, samplingHeaders } from '../sampling/samplingHeaders.ts'
import { textureJournals } from '../../../../../sdk-core/src/texture/writes.ts'
import type { createTileCounters } from '../counters.ts'
import type { TileKey } from '../page/pageTable.ts'
import { atlasKeyOf } from '../ids.ts'
import { MAX_LEVELS } from '../../texture/tiles.ts'

/** What the streamer is opened with. */
export type TileStreamerOptions = {
  device: GPUDevice
  color: TileTexture[]
  data: TileTexture[]
  /** Layers of each lane's pool, per atlas. */
  layers: AtlasLanes
  /** The encoding the lanes take: their formats, their texel cost, their level file. */
  encoding: PoolEncoding
  /** Tile bytes admitted per image outside a barrier. */
  budgetBytes: number
  /** Milliseconds a pass may spend copying tiles outside a barrier, the host's ceiling: the cap of
   *  the pass's stage on `clock`; the rest is deferred. */
  budgetMs: number
  /** The session's one main-thread clock (`WebgpuPagesRuntime.clock`): a pass is a stage of it,
   *  after the arrivals, and stops where the frame's share or its own ceiling is spent. */
  clock: FrameClock
  onFailure: (phase: string, error: unknown) => void
  /** Said when colour tiles arrived in a pump, a colour texture's sampling moved, or the pool was
   *  resized: the resources the image reads changed. */
  onColorChanged: () => void
}

/** The colour and data atlases of a streamer; `clock` is read when the feedback reduction stamps. */
export function openStreamerAtlases(
  device: GPUDevice,
  options: TileStreamerOptions,
  clock: () => number,
) {
  const { encoding } = options
  const color = createWebgpuTileAtlas(device, {
    kind: 'color',
    encoding,
    layers: options.layers.color,
    feedbackOffset: 0,
    textures: options.color,
    clock,
  })
  const data = createWebgpuTileAtlas(device, {
    kind: 'data',
    encoding,
    layers: options.layers.data,
    feedbackOffset: color.pages.entries,
    textures: options.data,
    clock,
  })
  return { color, data }
}

/** The sources of the streamer, holding the caches of every texture it catalogues. */
export function createHeldSources(
  device: GPUDevice,
  options: TileStreamerOptions,
  counters: ReturnType<typeof createTileCounters>,
) {
  const sources = createTileSources({
    device,
    encoding: options.encoding,
    counters,
    onFailure: options.onFailure,
  })
  for (const texture of [...options.color, ...options.data]) sources.hold(texture)
  return sources
}

/** The follow of the atlases' texture records: the headers that moved are written and a moved host
 *  picture copied again. */
export function createSamplingFollow(
  device: GPUDevice,
  atlases: readonly [WebgpuTileAtlas, WebgpuTileAtlas],
  sources: ReturnType<typeof createTileSources>,
  onColorChanged: TileStreamerOptions['onColorChanged'],
) {
  const [color, data] = atlases
  const flushAll = () => atlases.forEach((atlas) => atlas.flush(device))
  // The texture records written since the last render; closed at `destroy`.
  const journal = textureJournals.open()
  const followHeaders = samplingHeaders(color, data, journal)
  return {
    flushAll,
    followHeaders,
    journal,
    /** Pins every queue: what the image shows before any tile is requested. */
    prepare() {
      for (const atlas of atlases)
        atlas.pinTails(device.queue, (slot, place) => sources.tail(atlas, slot, place))
      followHeaders(true)
      flushAll()
    },
    /** Follows the atlases' records, writes the headers that moved and copies a moved host picture
     *  again, signalled as a landed tile is. True when a filter rule switched
     *  on or off: the rows that wear it change resolve class. */
    followSampling() {
      const found = followHeaders(false, sources)
      if (!(found & HEADERS_WRITTEN)) return false
      flushAll()
      onColorChanged()
      return (found & HEADERS_SWITCHED) !== 0
    },
  }
}

/**
 * Whether every tile of slot `slot` of the `kind` atlas resides at the level whose side matches
 * `pixels`, those that do not asked for the next pass beside the feedback, within what a pass
 * takes (`../requests.ts`, `ask`): what the warm-up of an HLOD actor not drawn yet asks
 * (`../../../frame/prepare/hlodWarm.ts`). Read once per image `frame` and level. A retired texture
 * or a level of the tail — always resident (`../tails.ts`) — is warm.
 */
export function createWarmth(
  color: WebgpuTileAtlas,
  data: WebgpuTileAtlas,
  requests: ReturnType<typeof createTileRequests>,
) {
  /** The image the warmth was last asked at, and per atlas, slot and level, its answer then:
   *  every switch asking the same texture in one image reads it once. */
  let warmFrame = -1
  const warmAt = new Map<number, boolean>()
  const key: TileKey = { slot: 0, level: 0, tx: 0, ty: 0 }
  return (kind: 'color' | 'data', slot: number, pixels: number, frame: number) => {
    const atlas = kind === 'color' ? color : data,
      entry = atlas.textures[slot]
    if (!entry || entry.retired) return true
    const { width, height, tail } = entry.layout
    const level = Math.max(0, Math.floor(Math.log2(Math.max(width, height) / Math.max(pixels, 1))))
    if (level >= tail) return true
    if (frame !== warmFrame) {
      warmFrame = frame
      warmAt.clear()
    }
    const id = atlasKeyOf(kind, slot * MAX_LEVELS + level)
    const known = warmAt.get(id)
    if (known !== undefined) return known
    let warm = true
    key.slot = slot
    key.level = level
    scan: for (key.ty = 0; key.ty < entry.layout.down[level]; key.ty++)
      for (key.tx = 0; key.tx < entry.layout.across[level]; key.tx++) {
        if (atlas.resides(key)) continue
        warm = false
        // The pass takes no more: the rest waits for the next image.
        if (!requests.ask(atlas, key)) break scan
      }
    warmAt.set(id, warm)
    return warm
  }
}
