// The bench's frames: each one played by the scenario, drawn by the page's own loop at a clock the
// bench sets (120 Hz, whatever the GPU takes), and given a window of its own — from its start to the
// next frame's, the GPU idle at both ends — in which everything it set off is counted: its passes,
// timed on the GPU, a command buffer the engine submitted late, the main thread's busy time.
import { performance as loop, type EventLoopUtilization } from 'node:perf_hooks'
import type { World } from '../../../packages/sdk-browser/src/session/world/world.ts'
import type { GpuPassTimings } from '../../../packages/sdk-core/src/contracts/metrics.ts'
import type { BenchGpu, Counts } from '../machine/device.ts'
import type { BenchBrowser } from '../page/dom.ts'
import type { FrameGpu } from '../passes/passSpans.ts'
import { watchedOf } from '../page/watched.ts'
import { settleWorkers } from '../../kit/worker.ts'

/** The display interval the bench's clock advances by, ms: a 120 Hz display. */
export const REFRESH_MS = 1000 / 120

/**
 * One frame as the bench saw it. `drawn`: the world drew an image in it. `gpu`: its passes timed on
 * the GPU and their union (`../passes/passTimer.ts`). `cpuMs`: the main thread's busy time over the window —
 * the image, and any long task after it. `wallMs`: the window's length. `loopMs`: from the frame's
 * start to its image. `engine…`: the engine's own numbers, the GPU ones those of the last image its
 * timer sampled.
 */
export type FrameRecord = {
  drawn: boolean
  gpu: FrameGpu | null
  cpuMs: number
  wallMs: number
  loopMs: number
  counts: Counts
  engineCpuMs: number | null
  engineGpuMs: number | null
  sample: GpuPassTimings | null
  /** The watched engine counters at the frame's image (`../page/watched.ts`). */
  counters: Record<string, number>
}

/** The parts of a bench run the frames use. */
export type FrameRig = { browser: BenchBrowser; gpu: BenchGpu; world: World }

/** The clock and frame number the frames run on, carried from one call to the next. A `frozen` clock gives the page the same
 *  timestamp at every frame: the world's time stands still while its pages load, so that a play starts the animations, the
 *  clip and the exposure from the same instant whatever the loading took. */
export const createClock = () => ({ time: 1000, frame: 0, frozen: false, step: REFRESH_MS })
export type BenchClock = ReturnType<typeof createClock>

/** Moves the clock on by its step — a display interval unless a scenario sets another, ms —, unless it is frozen; the frame number counts either way. */
export function tickClock(clock: BenchClock) {
  if (!clock.frozen) clock.time += clock.step
  clock.frame++
}

/** The engine counters that say the pages are still arriving: the geometry pages loaded and the texture tiles served, which only grow. */
const LOADING_COUNTERS = ['pageLoads', 'textureTilesServed'] as const
/** The pages in flight: while any is, the loading is not over, whatever the counters did. */
const IN_FLIGHT = 'pagesLoading'

/** One number of the metrics, or the named failure of a bench whose engine does not report it. */
function loadingMetric(metrics: Record<string, unknown> | null | undefined, key: string) {
  const value = metrics?.[key]
  if (typeof value !== 'number')
    throw new Error(
      `BENCH_LOADING: the engine's metrics carry no number ${key}, so the loading cannot be told over`,
    )
  return value
}

/**
 * Says when the loading is over: no page in flight and the counters of `LOADING_COUNTERS` not moved for `quiet` images in a row — the texture tiles left out once
 * `texturesIgnored` (their discovery by the feedback trickles on in a still view: a tile a few pixels read is found late, none is evicted). `push` takes the metrics of
 * each image drawn and answers whether the loading is over; a metric the engine does not report fails the bench by name.
 */
export function createLoadingTracker(quiet: number) {
  let geometry = '',
    tiles = 0,
    flying = 0,
    still = 0,
    stillGeometry = 0
  return {
    push(metrics: Record<string, unknown> | null | undefined, texturesIgnored = false) {
      const [pages, served] = LOADING_COUNTERS.map((key) => loadingMetric(metrics, key))
      flying = loadingMetric(metrics, IN_FLIGHT)
      const now = `${LOADING_COUNTERS[0]} ${pages}`
      stillGeometry = now === geometry && !flying ? stillGeometry + 1 : 0
      still = stillGeometry && served === tiles ? still + 1 : 0
      geometry = now
      tiles = served
      return (texturesIgnored ? stillGeometry : still) >= quiet
    },
    /** The texture tiles served by the last image. */
    get tiles() {
      return tiles
    },
    /** The counters of the last image, named: what a loading that never ends was still doing. */
    get last() {
      return `${geometry}, ${LOADING_COUNTERS[1]} ${tiles}, ${IN_FLIGHT} ${flying}`
    },
  }
}

/** Every so many images of a loading, the bench prints its counters: a loading that never ends shows what still moves. */
const LOADING_REPORT_IMAGES = 120
/** The images in a row with nothing arriving that end the loading. */
const LOADING_QUIET_IMAGES = 60

/** After so long the texture tiles still arriving no longer hold the loading: the geometry alone does. */
const LOADING_TEXTURES_MS = 30_000

/**
 * Draws frames at a frozen clock until the loading is over (`createLoadingTracker`; past `LOADING_TEXTURES_MS` the texture tiles no longer count, said with their
 * rate), `timeoutMs` at most, then thaws the clock: the world's time starts at zero for the play, the same after every loading. Throws when the geometry pages keep
 * arriving past the time.
 */
export async function settleLoading(rig: FrameRig, clock: BenchClock, timeoutMs: number) {
  const tracker = createLoadingTracker(LOADING_QUIET_IMAGES)
  const start = performance.now()
  let over = false,
    images = 0,
    texturesIgnored = false,
    tilesAtGrace = 0,
    imageAtGrace = 0
  const off = rig.world.onFrame(({ metrics }) => {
    over = tracker.push(metrics as unknown as Record<string, unknown>, texturesIgnored)
  })
  try {
    while (!over) {
      if (performance.now() - start > timeoutMs)
        throw new Error(
          `BENCH_LOADING: pages still arriving after ${(timeoutMs / 1000).toFixed(0)} s (${tracker.last})`,
        )
      if (!texturesIgnored && performance.now() - start > LOADING_TEXTURES_MS) {
        texturesIgnored = true
        tilesAtGrace = tracker.tiles
        imageAtGrace = images
      }
      await runFrames(rig, clock, 1)
      if (++images % LOADING_REPORT_IMAGES === 0)
        console.error(`[bench] loading, image ${images}: ${tracker.last}`)
    }
    if (texturesIgnored) {
      const tiles = tracker.tiles - tilesAtGrace
      console.error(
        `[bench] loading over on the geometry; texture tiles still arriving: ${tiles} in ${images - imageAtGrace} images`,
      )
    }
  } finally {
    off()
    clock.frozen = false
  }
}

const turn = () => new Promise((done) => setImmediate(done))

/** Draws `count` frames, `before(i)` playing the scenario's input ahead of the `i`-th. Yields to the
 *  event loop between frames, so the engine's readbacks and workers answer as in a page. */
export async function runFrames(
  rig: FrameRig,
  clock: BenchClock,
  count: number,
  before: (i: number) => void = () => {},
) {
  const records: FrameRecord[] = []
  /** Whether the world drew in the frame under way, when, and the engine's own numbers of its last
   *  image: its `onFrame` writes them. */
  const image = {
    drew: false,
    at: 0,
    cpu: null as number | null,
    gpu: null as number | null,
    sample: null as GpuPassTimings | null,
    counters: {} as Record<string, number>,
  }
  const off = rig.world.onFrame(({ metrics }) => {
    image.drew = true
    image.at = performance.now()
    image.cpu = metrics.cpuFrameMs ?? null
    image.gpu = metrics.gpuFrameMs ?? null
    image.sample = metrics.gpuPassMs ?? null
    image.counters = watchedOf(metrics as unknown as Record<string, unknown>)
  })
  const device = rig.gpu.held.device!
  let open: { record: FrameRecord; start: number; elu: EventLoopUtilization } | null = null
  /** Ends the open window: its GPU work done, its main thread's time read, its passes read back. */
  const close = async () => {
    if (!open) return
    const { record, start, elu } = open
    open = null
    record.counts = rig.gpu.take()
    // The timer's read back queues behind the frame's work: both done in one wait.
    ;[, record.gpu] = await Promise.all([device.queue.onSubmittedWorkDone(), rig.gpu.timer.close()])
    record.cpuMs = loop.eventLoopUtilization(elu).active
    record.wallMs = performance.now() - start
  }
  try {
    await device.queue.onSubmittedWorkDone()
    rig.gpu.take() // what came before the first frame is no frame's
    for (let i = 0; i < count; i++) {
      await close()
      // The workers answer the last frame before the next begins: the same frame, the same
      // answers, and their work counts in no frame's window.
      await settleWorkers()
      const record: FrameRecord = {
        drawn: false,
        gpu: null,
        cpuMs: Number.NaN,
        wallMs: Number.NaN,
        loopMs: Number.NaN,
        counts: rig.gpu.counts,
        engineCpuMs: null,
        engineGpuMs: null,
        sample: null,
        counters: {},
      }
      rig.gpu.timer.open(device)
      const start = performance.now()
      open = { record, start, elu: loop.eventLoopUtilization() }
      before(i)
      image.drew = false
      rig.browser.frame(clock.time)
      // The loop may draw once a promise it waits on settles: the image ends the wait, or the
      // frame has none to draw.
      for (let wait = 0; !image.drew && wait < 64; wait++) await turn()
      record.drawn = image.drew
      record.loopMs = (image.drew ? image.at : performance.now()) - start
      record.engineCpuMs = image.drew ? image.cpu : null
      record.engineGpuMs = image.gpu
      record.sample = image.sample
      record.counters = image.drew ? image.counters : {}
      records.push(record)
      tickClock(clock)
      await turn()
    }
    await close()
  } finally {
    off()
  }
  return records
}

/** Draws frames until `settle` of them are images the GPU timer measured, `timeoutMs` at most:
 *  the pipelines compiled and the pages resident. Returns the frames it took, or throws. */
/** Why the world's session failed, once no session has opened for `SESSION_FAILED_MS` with an error held; else null. An
 *  optional family's refusal leaves an error on a world whose session opens: it ends nothing. */
export function sessionFailure(world: World, held: { since?: number }) {
  const { error, sessions } = world.diagnostic as unknown as { error?: { code?: string; message?: string } | null; sessions: number }
  if (!error || sessions > 0) return (held.since = undefined), null
  held.since ??= performance.now()
  return performance.now() - held.since > SESSION_FAILED_MS ? `${error.code ?? ''} ${error.message ?? ''}` : null
}
const SESSION_FAILED_MS = 15000

export async function warmUp(rig: FrameRig, clock: BenchClock, timeoutMs: number, settle: number) {
  const start = performance.now()
  const held = {}
  let frames = 0,
    timed = 0
  while (timed < settle) {
    if (performance.now() - start > timeoutMs)
      throw new Error(
        `BENCH_WARMUP: no timed image after ${(timeoutMs / 1000).toFixed(0)} s (${frames} frames)`,
      )
    const failed = sessionFailure(rig.world, held)
    if (failed) throw new Error(`BENCH_WARMUP: the session failed to open: ${failed}`)
    const [record] = await runFrames(rig, clock, 1)
    frames++
    timed = record.drawn && record.engineGpuMs !== null ? timed + 1 : timed
    if (!record.drawn) await new Promise((done) => setTimeout(done, 4)) // a compile on its way
  }
  return frames
}
