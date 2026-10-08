// The numbers of a segment of a bench play, from its frames: the frame's GPU time on the bench's
// timer and on the engine's, the CPU, the hitches, the passes by their GPU time and the commands
// per frame.
import { stats } from '../core/chrono.ts'
import {
  gpuPassBlockOf,
  gpuPassStageOf,
  passOwnMs,
} from '../../packages/sdk-browser/src/stage/mapping.ts'
import { COUNTS, type Counts } from './device.ts'
import type { FrameRecord } from './frames.ts'

/** Plays agreeing within this relative spread of their medians make a stable segment. */
export const STABLE_SPREAD = 0.03

/** The `q` quantile of sorted `values`, linearly between its two neighbours. */
const quantile = (sorted: readonly number[], q: number) => {
  const at = (sorted.length - 1) * q
  const low = Math.floor(at)
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low)
}

/** Median, 95th percentile, lowest and highest of `values`, and how dispersed they are: `iqr`, the
 *  span of the middle half, and `std`; or `null` for none. */
export function spread(values: readonly number[]) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return null
  const { medianeMs: median, p95Ms: p95, minMs: min } = stats(finite)
  const sorted = [...finite].sort((a, b) => a - b)
  const mean = finite.reduce((sum, v) => sum + v, 0) / finite.length
  return {
    median,
    p95,
    min,
    max: Math.max(...finite),
    mean,
    n: finite.length,
    iqr: quantile(sorted, 0.75) - quantile(sorted, 0.25),
    std: Math.sqrt(finite.reduce((sum, v) => sum + (v - mean) ** 2, 0) / finite.length),
  }
}
export type Spread = NonNullable<ReturnType<typeof spread>>

/** A pass's label without the numbers that tell its batches apart: `vsm.raster 12` → `vsm.raster *`. */
export const passKey = (name: string) => name.replace(/ \d+$/, ' *').replace(/^Trillion3D /, '')

/** The engine's timing samples of `frames`, each once: a sample is read again until the next. */
function samplesOf(frames: readonly FrameRecord[]) {
  const seen = new Map<number, NonNullable<FrameRecord['sample']>>()
  for (const { sample } of frames) if (sample && !sample.truncated) seen.set(sample.frame, sample)
  return [...seen.values()]
}

/** A sampled image's GPU time on the engine's timer: its passes' own times, an overlap once. */
const sampleTotal = (sample: NonNullable<FrameRecord['sample']>) =>
  sample.passes.reduce((sum, pass) => sum + (passOwnMs(pass) ?? 0), 0)

/** Each pass's own GPU time per image the engine's timer sampled, its stage and its share. */
export function passTimes(frames: readonly FrameRecord[]) {
  const samples = samplesOf(frames)
  const byPass = new Map<string, number[]>()
  const kinds = new Map<string, { stage: string; block: string }>()
  const totals: number[] = []
  for (const sample of samples) {
    const sums = new Map<string, number>()
    let total = 0
    for (const pass of sample.passes) {
      const ms = passOwnMs(pass)
      if (ms === null || ms === undefined) continue
      const key = passKey(pass.name)
      if (!kinds.has(key))
        kinds.set(key, { stage: gpuPassStageOf(pass.name), block: gpuPassBlockOf(pass.name) })
      sums.set(key, (sums.get(key) ?? 0) + ms)
      total += ms
    }
    totals.push(total)
    for (const [key, ms] of sums) {
      const all = byPass.get(key) ?? []
      all.push(ms)
      byPass.set(key, all)
    }
  }
  const image = spread(totals)?.median ?? 0
  const passes = [...byPass].map(([name, ms]) => {
    // A pass absent from a sample took no time in it.
    const all = [...ms, ...Array(samples.length - ms.length).fill(0)]
    const time = spread(all)!
    return { name, ...kinds.get(name)!, ...time, share: image ? time.median / image : 0 }
  })
  passes.sort((a, b) => b.median - a.median)
  const stages = new Map<string, number>()
  for (const pass of passes) stages.set(pass.stage, (stages.get(pass.stage) ?? 0) + pass.median)
  return {
    samples: samples.length,
    passes,
    stages: [...stages]
      .map(([stage, median]) => ({ stage, median }))
      .sort((a, b) => b.median - a.median),
  }
}

/** The median of each count over `frames`, those that drew an image. */
export function countsPerFrame(frames: readonly FrameRecord[]) {
  const drawn = frames.filter((frame) => frame.drawn)
  return Object.fromEntries(
    COUNTS.map((key) => [key, spread(drawn.map((frame) => frame.counts[key]))?.median ?? 0]),
  ) as Counts
}

/** A frame's own GPU time in passes of `kind`. */
const kindMs = (frame: FrameRecord, kind: 'compute' | 'render') =>
  frame.gpu!.passes.reduce((sum, pass) => sum + (pass.kind === kind ? pass.ms : 0), 0)

/** One segment's frame numbers. GPU: the union of every pass on the bench's timer. CPU: the main
 *  thread's busy time over each frame's window. A hitch: a frame whose window lasted twice the
 *  segment's median. */
export function roundNumbers(frames: readonly FrameRecord[]) {
  const drawn = frames.filter((frame) => frame.drawn)
  const complete = drawn.filter((frame) => frame.gpu?.complete)
  const gpu = complete.map((frame) => frame.gpu!.unionMs)
  const wall = spread(drawn.map((frame) => frame.wallMs))?.median ?? Infinity
  /** The frames whose window lasted twice the median, each with what it made or sent — a
   *  pipeline compiled, memory made, bytes uploaded — that the other frames did not. */
  const hitches = frames.flatMap((frame, i) =>
    frame.drawn && frame.wallMs > 2 * wall
      ? [
          {
            frame: i,
            wallMs: frame.wallMs,
            cpuMs: frame.cpuMs,
            gpuMs: frame.gpu?.unionMs ?? null,
            pipelinesMade: frame.counts.pipelinesMade,
            buffersMade: frame.counts.buffersMade,
            bufferBytesMade: frame.counts.bufferBytesMade,
            texturesMade: frame.counts.texturesMade,
            writtenBytes: frame.counts.writtenBytes,
            submits: frame.counts.submits,
          },
        ]
      : [],
  )
  const lastDrawn = frames.findLastIndex((frame) => frame.drawn)
  return {
    frames: frames.length,
    drawn: drawn.length,
    gpuMs: spread(gpu),
    /** The frame's GPU time split by the kind of pass: compute shaders, and drawing. */
    computeMs: spread(complete.map((frame) => kindMs(frame, 'compute'))),
    renderMs: spread(complete.map((frame) => kindMs(frame, 'render'))),
    idleMs: spread(complete.map((frame) => frame.gpu!.gapMs)),
    cpuMs: spread(drawn.map((frame) => frame.cpuMs)),
    wallMs: spread(drawn.map((frame) => frame.wallMs)),
    loopMs: spread(drawn.map((frame) => frame.loopMs)),
    engineGpuMs: spread(samplesOf(drawn).map(sampleTotal)),
    engineFrameGpuMs: spread(drawn.map((frame) => frame.engineGpuMs ?? NaN)),
    engineCpuMs: spread(drawn.map((frame) => frame.engineCpuMs ?? NaN)),
    worstGpuMs: Math.max(0, ...gpu),
    worstCpuMs: Math.max(0, ...drawn.map((frame) => frame.cpuMs).filter(Number.isFinite)),
    hitchFrames: hitches.map((hitch) => hitch.frame),
    hitches,
    /** The frame after which the segment drew nothing more — a still image held — or null. */
    heldFrom: lastDrawn < frames.length - 1 ? lastDrawn + 1 : null,
  }
}
