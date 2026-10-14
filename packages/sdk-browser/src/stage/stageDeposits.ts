import { cpuNow, msSince } from '../diagnostic/stopwatch.ts'
import {
  stageLabel,
  stageQuantiles,
  type GpuTimingMethod,
  type StageProfile,
  type StageProfileEntry,
} from '../../../sdk-core/src/runtime/stageProfile.ts'
import type { StageAdd } from './profiler.ts'
import { createRings } from './stageRings.ts'

/**
 * The per-stage profile: a ring of durations per stage, CPU side and GPU side, separate and never
 * added. Each filed row deposits its bounds onto their stages (`stepStages`), each GPU readback its
 * passes. A stage that deposited nothing on the window stays "unmeasured" (`null`); it is never
 * zero. Nothing is allocated per image, and the cost of the deposits is timed in `overheadMs`.
 */
export function createStageDeposits(options: {
  backend: string
  stages: readonly string[]
  /** Stage index of each CPU bound, `-1` for a sum or a stage the profile does not publish. */
  stepStages: Int32Array
  gpuMethod: GpuTimingMethod | null
  gpuReason: string | null
  capacity: number
}) {
  const { stages, stepStages, capacity } = options
  const cpu = createRings(stages.length, capacity),
    gpu = createRings(stages.length, capacity),
    overhead = createRings(1, capacity),
    image = createRings(1, capacity)
  // A stage may be fed by several bounds of the same image: they are summed here, then deposited
  // once. Without that, the quantiles would mix distinct populations.
  const sums = new Float64Array(stages.length),
    touched = new Uint8Array(stages.length)
  const counts = new Map<string, Readonly<Record<string, number>>>()
  const gpuReasons = new Map<string, string>(),
    cpuReasons = new Map<string, string>()
  let cpuFrames = 0,
    gpuSamples = 0,
    gpuMethod = options.gpuMethod,
    gpuReason = options.gpuReason

  const add: StageAdd = (at, ms) => {
    if (!(at >= 0 && at < stages.length && Number.isFinite(ms) && ms >= 0)) return
    sums[at] += ms
    touched[at] = 1
  }
  const open = () => {
    sums.fill(0)
    touched.fill(0)
    return cpuNow()
  }
  const close = (rings: ReturnType<typeof createRings>, started: number) => {
    for (let at = 0; at < stages.length; at++) if (touched[at]) rings.push(at, sums[at])
    overhead.push(0, msSince(started))
  }

  return {
    /** Deposits each bound of a filed row onto its stage. */
    fileRow(row: Float64Array) {
      const started = open()
      for (let c = 0; c < row.length; c++) add(stepStages[c], row[c])
      close(cpu, started)
      cpuFrames++
    },
    /** Deposits the durations of a GPU readback, which describes an image already past. */
    frameGpu(fill: (add: StageAdd) => void) {
      const started = open()
      fill(add)
      close(gpu, started)
      gpuSamples++
    },
    /** Duration of the whole image, on an engine that cannot split it into passes. */
    pushImageGpu(ms: number) {
      if (Number.isFinite(ms) && ms >= 0) image.push(0, ms)
    },
    /** Counters attached to a stage: they are not durations and add to nothing. */
    setCounts(stage: string, values: Readonly<Record<string, number>>) {
      counts.set(stage, values)
    },
    /** Why a stage has no duration, when the reason is structural and not an omission. */
    setReason(stage: string, reason: { cpu?: string; gpu?: string }) {
      if (reason.cpu) cpuReasons.set(stage, reason.cpu)
      if (reason.gpu) gpuReasons.set(stage, reason.gpu)
    },
    /** Measurement means the device kept, discovered at run time. */
    setGpuMethod(method: GpuTimingMethod | null, reason: string | null) {
      gpuMethod = method
      gpuReason = reason
    },
    /** Opens the stage window again: what came before (warmup, first images) no longer weighs on
     *  its quantiles. */
    reset() {
      cpu.clear()
      gpu.clear()
      overhead.clear()
      image.clear()
      cpuFrames = 0
      gpuSamples = 0
    },
    /** The per-stage profile over the stage window. */
    profile(): StageProfile {
      const entries: StageProfileEntry[] = []
      for (let at = 0; at < stages.length; at++) {
        const stage = stages[at]
        const cpuMs = stageQuantiles(cpu.values(at)),
          gpuMs = stageQuantiles(gpu.values(at))
        const entry: StageProfileEntry = { stage, label: stageLabel(stage), cpuMs, gpuMs }
        if (!cpuMs) {
          const reason = cpuReasons.get(stage)
          if (reason) entry.cpuReason = reason
        }
        if (!gpuMs) {
          const reason = gpuReasons.get(stage) ?? gpuReason
          if (reason) entry.gpuReason = reason
        }
        const stageCounts = counts.get(stage)
        if (stageCounts) entry.counts = stageCounts
        entries.push(entry)
      }
      return {
        version: 1,
        enabled: true,
        backend: options.backend,
        cpuFrames,
        gpuSamples,
        windowFrames: capacity,
        gpuMethod,
        gpuReason,
        gpuImageMs: stageQuantiles(image.values(0)),
        overheadMs: stageQuantiles(overhead.values(0)),
        stages: entries,
      }
    },
  }
}
