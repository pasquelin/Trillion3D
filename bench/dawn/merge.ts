// The plays of one scenario, merged: per segment, the median of the plays' medians and how far the
// plays spread (stable or not), and whether they drew the same images — the same situation, frame
// for frame, gives the same pixels, so a difference between two versions is theirs.
import { readFileSync } from 'node:fs'
import { decodePng } from '../../packages/sdk-node/src/cutout/png.mts'
import { pixelDifference } from './capture.ts'
import type { BenchPlay } from './play.ts'
import { spread, STABLE_SPREAD } from './summary.ts'

const pixels = (path: string) => decodePng(readFileSync(path)).rgba

/** The plays' numbers of one segment, by name. */
function mergeSegment(plays: readonly BenchPlay[], name: string) {
  const of = plays.map((play) => play.segments.find((segment) => segment.name === name)!)
  const medians = of.map((segment) => segment.numbers.gpuMs?.median ?? Number.NaN)
  const gpu = spread(medians)
  const relative = gpu && gpu.n > 1 ? (gpu.max - gpu.min) / gpu.median : null
  const images = of.map((segment) => segment.image?.path)
  const first = images[0] ? pixels(images[0]) : null
  const sameImages = images
    .slice(1)
    .map((path) => (first && path ? pixelDifference(first, pixels(path)) : null))
  /** The plays' medians of one of a segment's numbers. */
  const across = (
    key:
      | 'gpuMs'
      | 'computeMs'
      | 'renderMs'
      | 'cpuMs'
      | 'wallMs'
      | 'loopMs'
      | 'engineGpuMs'
      | 'engineCpuMs',
  ) => spread(of.map((segment) => segment.numbers[key]?.median ?? Number.NaN))
  const mid = of[middle(medians)]
  return {
    name,
    measured: of[0].measured,
    plays: of.length,
    gpuMs: gpu,
    spread: relative,
    stable: relative !== null && relative <= STABLE_SPREAD,
    engineGpuMs: across('engineGpuMs'),
    computeMs: across('computeMs'),
    renderMs: across('renderMs'),
    cpuMs: across('cpuMs'),
    wallMs: across('wallMs'),
    loopMs: across('loopMs'),
    engineCpuMs: across('engineCpuMs'),
    worstGpuMs: Math.max(...of.map((segment) => segment.numbers.worstGpuMs)),
    worstCpuMs: Math.max(...of.map((segment) => segment.numbers.worstCpuMs)),
    hitchFrames: of.map((segment) => segment.numbers.hitchFrames),
    /** The first play's hitches, each with what it made and sent. */
    hitches: of[0].numbers.hitches,
    heldFrom: of.map((segment) => segment.numbers.heldFrom),
    drawn: of.map((segment) => `${segment.numbers.drawn}/${segment.numbers.frames}`),
    /** The middle play's passes and commands: the play whose time is the median. */
    passes: mid.passes,
    benchPasses: mid.benchPasses,
    counts: mid.counts,
    images,
    sameImages,
  }
}

/** The index of the median of `values`. */
const middle = (values: readonly number[]) =>
  values.map((value, i) => [value, i]).sort((a, b) => a[0] - b[0])[(values.length - 1) >> 1][1]

/** The report of `plays` of one scenario: the first play's settings, every segment merged, the
 *  profiled play's CPU (the last, when one was profiled). */
export function mergePlays(plays: readonly BenchPlay[]) {
  const [first] = plays
  const profiled = [...plays].reverse().find((play) => play.cpu)
  return {
    bench: first.bench,
    plays: plays.length,
    gpuBusy: plays.map((play) => play.gpuBusy),
    readySeconds: spread(plays.map((play) => play.readySeconds)),
    calibration: spread(plays.map((play) => play.calibration.median)),
    gbPerSecond: spread(plays.map((play) => play.calibration.gbPerSecond)),
    segments: first.segments.map((segment) => mergeSegment(plays, segment.name)),
    cpu: profiled?.cpu ?? null,
    cpuSteps: profiled?.cpuSteps ?? null,
    engine: first.engine,
    errors: plays.flatMap((play) => play.errors),
  }
}

export type BenchReport = ReturnType<typeof mergePlays>
