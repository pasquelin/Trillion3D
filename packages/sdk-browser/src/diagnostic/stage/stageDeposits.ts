import { cpuNow, msSince } from '../stopwatch.ts'
import {
  stageLabel,
  stageQuantiles,
  type GpuTimingMethod,
  type StageProfile,
  type StageProfileEntry,
} from '../../../../sdk-core/src/runtime/stageProfile.ts'
import type { StageAdd } from './profiler.ts'
import { createRings } from '../../../../math/src/sequence/rings.ts'

/** The steps of each stage, in table order, from the engine's step table: a step with no stage
 *  (`null`, a sum) belongs to none. */
export function stepsByStage(names: readonly string[], stages: ReadonlyArray<string | null>) {
  const steps = new Map<string, string[]>()
  names.forEach((name, index) => {
    const stage = stages[index]
    if (stage === null) return
    const list = steps.get(stage)
    if (list) list.push(name)
    else steps.set(stage, [name])
  })
  return steps
}

/** What explains the stages: structural reasons for a missing duration, and counters. */
interface StageNotes {
  cpuReasons: Map<string, string>
  gpuReasons: Map<string, string>
  counts: Map<string, Readonly<Record<string, number>>>
}

/** The profile's entry of each stage over the stage window; `gpuReason` is the reason a stage
 *  without a duration of its own takes. */
function stageEntries(
  stages: readonly string[],
  cpu: ReturnType<typeof createRings>,
  gpu: ReturnType<typeof createRings>,
  notes: StageNotes,
  gpuReason: string | null,
) {
  const entries: StageProfileEntry[] = []
  for (let at = 0; at < stages.length; at++) {
    const stage = stages[at]
    const cpuMs = stageQuantiles(cpu.values(at)),
      gpuMs = stageQuantiles(gpu.values(at))
    const entry: StageProfileEntry = { stage, label: stageLabel(stage), cpuMs, gpuMs }
    if (!cpuMs) {
      const reason = notes.cpuReasons.get(stage)
      if (reason) entry.cpuReason = reason
    }
    if (!gpuMs) {
      const reason = notes.gpuReasons.get(stage) ?? gpuReason
      if (reason) entry.gpuReason = reason
    }
    const stageCounts = notes.counts.get(stage)
    if (stageCounts) entry.counts = stageCounts
    entries.push(entry)
  }
  return entries
}

/** The sums a stage collects while a row or a readback is deposited. A stage may be fed by several
 *  bounds of the same image: they are summed here, then pushed once. Without that, the quantiles
 *  would mix distinct populations. The cost of the deposit is timed into `overhead`. */
function depositBuffer(stageCount: number, overhead: ReturnType<typeof createRings>) {
  const sums = new Float64Array(stageCount),
    touched = new Uint8Array(stageCount)
  const add: StageAdd = (at, ms) => {
    if (!(at >= 0 && at < stageCount && Number.isFinite(ms) && ms >= 0)) return
    sums[at] += ms
    touched[at] = 1
  }
  const open = () => {
    sums.fill(0)
    touched.fill(0)
    return cpuNow()
  }
  const close = (rings: ReturnType<typeof createRings>, started: number) => {
    for (let at = 0; at < stageCount; at++) if (touched[at]) rings.push(at, sums[at])
    overhead.push(0, msSince(started))
  }
  return { add, open, close }
}

/** The notes of the stages and the two calls that write them. */
function stageNotes() {
  const notes: StageNotes = { cpuReasons: new Map(), gpuReasons: new Map(), counts: new Map() }
  return {
    notes,
    /** Counters attached to a stage: they are not durations and add to nothing. */
    setCounts(stage: string, values: Readonly<Record<string, number>>) {
      notes.counts.set(stage, values)
    },
    /** Why a stage has no duration, when the reason is structural and not an omission. */
    setReason(stage: string, reason: { cpu?: string; gpu?: string }) {
      if (reason.cpu) notes.cpuReasons.set(stage, reason.cpu)
      if (reason.gpu) notes.gpuReasons.set(stage, reason.gpu)
    },
  }
}

/** What the per-stage profile is made for. */
interface StageDepositOptions {
  backend: string
  stages: readonly string[]
  /** Stage index of each CPU bound, `-1` for a sum or a stage the profile does not publish. */
  stepStages: Int32Array
  gpuMethod: GpuTimingMethod | null
  gpuReason: string | null
  capacity: number
}

/** The rings of a stage profile: durations per stage on each side, the whole image and the cost. */
interface StageRings {
  cpu: ReturnType<typeof createRings>
  gpu: ReturnType<typeof createRings>
  overhead: ReturnType<typeof createRings>
  image: ReturnType<typeof createRings>
}

/** What the profile counts and says of its means, which change at run time. */
interface DepositRun {
  cpuFrames: number
  gpuSamples: number
  gpuMethod: GpuTimingMethod | null
  gpuReason: string | null
}

/** The per-stage profile over the stage window. */
function profileOf(
  options: StageDepositOptions,
  rings: StageRings,
  notes: StageNotes,
  run: DepositRun,
): StageProfile {
  return {
    version: 1,
    enabled: true,
    backend: options.backend,
    cpuFrames: run.cpuFrames,
    gpuSamples: run.gpuSamples,
    windowFrames: options.capacity,
    gpuMethod: run.gpuMethod,
    gpuReason: run.gpuReason,
    gpuImageMs: stageQuantiles(rings.image.values(0)),
    overheadMs: stageQuantiles(rings.overhead.values(0)),
    stages: stageEntries(options.stages, rings.cpu, rings.gpu, notes, run.gpuReason),
  }
}

/**
 * The per-stage profile: a ring of durations per stage, CPU side and GPU side, separate and never
 * added. Each filed row deposits its bounds onto their stages (`stepStages`), each GPU readback its
 * passes. A stage that deposited nothing on the window stays "unmeasured" (`null`); it is never
 * zero. Nothing is allocated per image, and the cost of the deposits is timed in `overheadMs`.
 */
export function createStageDeposits(options: StageDepositOptions) {
  const { stages, stepStages, capacity } = options
  const rings: StageRings = {
    cpu: createRings(stages.length, capacity),
    gpu: createRings(stages.length, capacity),
    overhead: createRings(1, capacity),
    image: createRings(1, capacity),
  }
  const { add, open, close } = depositBuffer(stages.length, rings.overhead)
  const { notes, setCounts, setReason } = stageNotes()
  const run: DepositRun = {
    cpuFrames: 0,
    gpuSamples: 0,
    gpuMethod: options.gpuMethod,
    gpuReason: options.gpuReason,
  }

  return {
    /** Deposits each bound of a filed row onto its stage. */
    fileRow(row: Float64Array) {
      const started = open()
      for (let c = 0; c < row.length; c++) add(stepStages[c], row[c])
      close(rings.cpu, started)
      run.cpuFrames++
    },
    /** Deposits the durations of a GPU readback, which describes an image already past. */
    frameGpu(fill: (add: StageAdd) => void) {
      const started = open()
      fill(add)
      close(rings.gpu, started)
      run.gpuSamples++
    },
    /** Duration of the whole image, on an engine that cannot split it into passes. */
    pushImageGpu(ms: number) {
      if (Number.isFinite(ms) && ms >= 0) rings.image.push(0, ms)
    },
    setCounts,
    setReason,
    /** Measurement means the device kept, discovered at run time. */
    setGpuMethod(method: GpuTimingMethod | null, reason: string | null) {
      run.gpuMethod = method
      run.gpuReason = reason
    },
    /** Opens the stage window again: what came before (warmup, first images) no longer weighs on
     *  its quantiles. */
    reset() {
      for (const ring of Object.values(rings)) ring.clear()
      run.cpuFrames = 0
      run.gpuSamples = 0
    },
    /** The per-stage profile over the stage window. */
    profile: () => profileOf(options, rings, notes, run),
  }
}
