// The bench's frames: each one played by the scenario, drawn by the page's own loop at a clock the
// bench sets (120 Hz, whatever the GPU takes), and given a window of its own — from its start to the
// next frame's, the GPU idle at both ends — in which everything it set off is counted: its passes,
// timed on the GPU, a command buffer the engine submitted late, the main thread's busy time.
import { performance as loop, type EventLoopUtilization } from 'node:perf_hooks'
import type { World } from '../../packages/sdk-browser/src/index.ts'
import type { GpuPassTimings } from '../../packages/sdk-core/src/index.ts'
import type { BenchGpu, Counts } from './device.ts'
import type { BenchBrowser } from './dom.ts'
import type { FrameGpu } from './passTimer.ts'
import { settleWorkers } from './worker.ts'

/** The display interval the bench's clock advances by, ms: a 120 Hz display. */
export const REFRESH_MS = 1000 / 120

/**
 * One frame as the bench saw it. `drawn`: the world drew an image in it. `gpu`: its passes timed on
 * the GPU and their union (`passTimer.ts`). `cpuMs`: the main thread's busy time over the window —
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
}

/** The parts of a bench run the frames use. */
export type FrameRig = { browser: BenchBrowser; gpu: BenchGpu; world: World }

/** The clock and frame number the frames run on, carried from one call to the next. */
export const createClock = () => ({ time: 1000, frame: 0 })
export type BenchClock = ReturnType<typeof createClock>

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
  }
  const off = rig.world.onFrame(({ metrics }) => {
    image.drew = true
    image.at = performance.now()
    image.cpu = metrics.cpuFrameMs ?? null
    image.gpu = metrics.gpuFrameMs ?? null
    image.sample = metrics.gpuPassMs ?? null
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
      records.push(record)
      clock.time += REFRESH_MS
      clock.frame++
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
export async function warmUp(rig: FrameRig, clock: BenchClock, timeoutMs: number, settle: number) {
  const start = performance.now()
  let frames = 0,
    timed = 0
  while (timed < settle) {
    if (performance.now() - start > timeoutMs)
      throw new Error(
        `BENCH_WARMUP: no timed image after ${(timeoutMs / 1000).toFixed(0)} s (${frames} frames)`,
      )
    const [record] = await runFrames(rig, clock, 1)
    frames++
    timed = record.drawn && record.engineGpuMs !== null ? timed + 1 : timed
    if (!record.drawn) await new Promise((done) => setTimeout(done, 4)) // a compile on its way
  }
  return frames
}
