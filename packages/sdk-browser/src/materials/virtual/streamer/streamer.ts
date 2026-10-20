import type { AtlasLanes, PoolEncoding } from '../../texture/blockFormats.ts'
import { createWebgpuTileAtlas } from '../atlas/atlas.ts'
import type { TileTexture } from '../tileTexture.ts'
import type { FrameClock } from '../../../geometry/integration/frameBudget.ts'
import { createWebgpuTileFeedback } from '../feedback.ts'
import { createTileSources } from '../sources/sources.ts'
import { createTilePublish } from '../publish.ts'
import { createTileCounters } from '../counters.ts'
import { createTileRequests } from '../requests.ts'
import { createTileGrowth } from '../growth.ts'
import { HEADERS_SWITCHED, HEADERS_WRITTEN, samplingHeaders } from '../sampling/samplingHeaders.ts'
import { textureJournals } from '../../../../../sdk-core/src/texture/writes.ts'
import { surfaceJournals } from '../../../geometry/pages/surfaceWrites.ts'
import { createTilePump } from '../pump.ts'
import type { TileKey } from '../page/pageTable.ts'
/**
 * Tile streamer: what the image asked becomes resident, under a per-image budget in bytes AND in
 * milliseconds, most looked-at tile first. Image-feedback counters name the tiles; the streamer
 * skips those that reside, reads the cooked levels of the others and copies them as soon as
 * their bytes are there, taking the places the GPU's queue gives up when the pool is full: the
 * places no pixel read of late (`../publish.ts`).
 *
 * Both budgets are fixed by the host, never read off the machine. The millisecond one is what
 * keeps a cold traversal from stalling the frame: a pass stops copying once it has spent it, the
 * remainder is deferred to the next pass — shown meanwhile by its finest resident ancestor level —
 * and the worst pass of the session is published (`textureUploadPeakMs`), since a stutter is a
 * peak, never a median.
 *
 * Nothing waits here: a tile whose level is still being read comes back on the next feedback. Only
 * the barrier (`flush`) asks for convergence: every pixel speaks, the budgets are lifted, the loop
 * replays until no requested tile is missing.
 */
export function createWebgpuTileStreamer(options: {
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
  /** Colour textures a tile of which arrived or was evicted in this pump, or whose sampling moved
   *  — what a cutout-foliage shadow follows —, or `-1` when the pool was resized. */
  onColorChanged: (slots: ReadonlySet<number> | -1) => void
}) {
  const { device, encoding } = options
  /** Colour textures a pump served or evicted a tile of, named once each. */
  const colorChanged = new Set<number>()
  const color = createWebgpuTileAtlas(device, {
    kind: 'color',
    encoding,
    layers: options.layers.color,
    feedbackOffset: 0,
    textures: options.color,
    onEvicted: (slot) => colorChanged.add(slot),
    clock: () => published.clock,
  })
  const data = createWebgpuTileAtlas(device, {
    kind: 'data',
    encoding,
    layers: options.layers.data,
    feedbackOffset: color.pages.entries,
    textures: options.data,
    clock: () => published.clock,
  })
  const feedback = createWebgpuTileFeedback(device, color.pages.entries + data.pages.entries)
  const counters = createTileCounters()
  const sources = createTileSources({
    device,
    encoding,
    counters,
    onFailure: options.onFailure,
  })
  for (const texture of [...options.color, ...options.data]) sources.hold(texture)
  const requests = createTileRequests({ feedback, color, data, counters })
  const atlases = [color, data]
  const published = createTilePublish(device, feedback, atlases)
  const flushAll = () => atlases.forEach((atlas) => atlas.flush(device))
  // The texture and surface records written since the last render; closed at `destroy`.
  const journal = textureJournals.open(),
    surfaces = surfaceJournals.open()
  const followHeaders = samplingHeaders(color, data, journal, surfaces)
  /** The image the warmth was last asked at, and per atlas, slot and level, its answer then:
   *  every switch asking the same texture in one image reads it once. */
  let warmFrame = -1
  const warmAt = new Map<number, boolean>()
  const key: TileKey = { slot: 0, level: 0, tx: 0, ty: 0 }
  return {
    color,
    data,
    feedback,
    counters,
    sources,
    /** Pins every queue: what the image shows before any tile is requested. */
    prepare() {
      for (const atlas of atlases)
        atlas.pinTails(device.queue, (slot, place) => sources.tail(atlas, slot, place))
      followHeaders(true)
      flushAll()
    },
    pump: createTilePump({
      ...options,
      color,
      colorChanged,
      sources,
      requests,
      counters,
      flushAll,
    }),
    /** Follows the atlases' records, writes the headers that moved and copies a moved host picture
     *  again, signalled as a landed tile is. True when a filter rule switched
     *  on or off: the rows that wear it change resolve class. */
    followSampling() {
      colorChanged.clear()
      const found = followHeaders(false, colorChanged, sources)
      if (!(found & HEADERS_WRITTEN)) return false
      flushAll()
      options.onColorChanged(colorChanged)
      return (found & HEADERS_SWITCHED) !== 0
    },
    /**
     * Whether every tile of slot `slot` of the `kind` atlas resides at the level whose side matches
     * `pixels`, those that do not asked for the next pass beside the feedback, within what a pass
     * takes (`../requests.ts`, `ask`): what a switch to an HLOD actor not drawn yet waits on
     * (`../../../frame/prepare/hlodWarm.ts`). Read once per image `frame` and level. A retired texture
     * or a level of the tail — always resident (`../tails.ts`) — is warm.
     */
    warm(kind: 'color' | 'data', slot: number, pixels: number, frame: number) {
      const atlas = kind === 'color' ? color : data,
        entry = atlas.textures[slot]
      if (!entry || entry.retired) return true
      const { width, height, tail } = entry.layout
      const level = Math.max(
        0,
        Math.floor(Math.log2(Math.max(width, height) / Math.max(pixels, 1))),
      )
      if (level >= tail) return true
      if (frame !== warmFrame) {
        warmFrame = frame
        warmAt.clear()
      }
      const id = (slot * 16 + level) * 2 + (kind === 'color' ? 0 : 1)
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
    },
    /** An image's feedback leaves with it (`../publish.ts`). */
    publishRequests: published.publish,
    ...createTileGrowth(options, {
      color,
      data,
      feedback,
      sources,
      flushAll,
      followHeaders,
      resetRequests: requests.reset,
    }),
    metrics: () => counters.metrics(atlases, sources, encoding.name),
    /** True while a level is read or a working texture built: a missing tile can still come. */
    get reading() {
      return sources.reading
    },
    /** Held when feedback, level reads and the working textures asked have all landed. */
    settled: () => Promise.all([feedback.settled(), sources.settled()]).then(() => undefined),
    destroy() {
      textureJournals.close(journal)
      surfaceJournals.close(surfaces)
      sources.destroy()
      published.destroy()
      feedback.destroy()
      color.destroy()
      data.destroy()
    },
  }
}
export type WebgpuTileStreamer = ReturnType<typeof createWebgpuTileStreamer>
