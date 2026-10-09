import { quantile } from '../../../math/src/scalar/quantile.ts'
import {
  disabledStageProfile,
  stageLabel,
  type GpuTimingMethod,
  type StageProfile,
  type StageProfileEntry,
  type StageQuantiles,
} from '../../../sdk-core/src/index.ts'

/** Default sliding window of the stage profile: two seconds at 60 images per second. */
const DEFAULT_WINDOW = 120
/** Images the CPU bound windows read back, at most. */
const DEFAULT_STEP_CAPACITY = 256
/** Slowest images each CPU bound window keeps, by total. */
const DEFAULT_WORST = 10

export type StageAdd = (stage: string, ms: number) => void

/**
 * An ordered declaration of an engine's CPU bounds: for each, the public name and the
 * profile stage it deposits to — `null` for a sum, which is not deposited, or it would
 * count a second time what its parts already deposited. Names, stages and write indices
 * all come from the same table: they cannot silently misalign.
 */
export function cpuStepTable<Table extends ReadonlyArray<readonly [string, string | null]>>(
  table: Table,
): {
  names: readonly string[]
  stages: ReadonlyArray<string | null>
  /** Index of a bound in the profile row, read by its name and never written by hand. */
  at: Record<Table[number][0], number>
} {
  return {
    names: table.map(([name]) => name),
    stages: table.map(([, stage]) => stage),
    // `fromEntries` cannot yield literal keys: the declared name carries them.
    at: Object.fromEntries(table.map(([name], index) => [name, index])) as Record<
      Table[number][0],
      number
    >,
  }
}

/**
 * CPU step profile of a render loop: a bounded ring of recent images plus the worst images by total
 * duration, summarised on demand. It exists so an engine can report where its own CPU time goes in
 * `summary` mode — turning the per-frame trace on to find that out changes the timing being measured.
 * Nothing is allocated per image: the caller fills the scratch row and hands it over. Two windows
 * over the same images — one on the publish cadence, one a host pulls — share that row (`row`).
 */
export type CpuStepSummary = {
  /** Frames measured. */
  frames: number
  /** Time of each step: median, 95th and worst. */
  steps: Record<string, { p50: number; p95: number; max: number }>
  /** The slowest frames, step by step. */
  worst: Array<Record<string, number>>
}

/**
 * The two windows over the filed images: `published` on the cadence of the engine's CPU
 * diagnostic, `host` opened by `reset` and read by the host. Each forgets on its own read, so
 * neither forgets for the other.
 */
type CpuStepWindow = 'published' | 'host'

/** `count` rings of `capacity` recent values each. Order does not matter: only quantiles are read. */
function createRings(count: number, capacity: number) {
  const data = new Float64Array(count * capacity),
    cursor = new Uint32Array(count),
    filled = new Uint32Array(count)
  return {
    data,
    filled,
    push(ring: number, value: number) {
      data[ring * capacity + (cursor[ring] % capacity)] = value
      cursor[ring]++
      if (filled[ring] < capacity) filled[ring]++
    },
    clear() {
      cursor.fill(0)
      filled.fill(0)
    },
  }
}

/** The slowest images of a window by total, sorted descending, each with its whole row. */
function createWorst(width: number, count: number) {
  const rows = new Float64Array(count * width),
    total = new Float64Array(count),
    frame = new Float64Array(count)
  let filled = 0
  return {
    file(row: Float64Array, at: number, ms: number) {
      if (filled === count && ms <= total[filled - 1]) return
      let slot = Math.min(filled, count - 1)
      while (slot > 0 && total[slot - 1] < ms) {
        total[slot] = total[slot - 1]
        frame[slot] = frame[slot - 1]
        rows.copyWithin(slot * width, (slot - 1) * width, slot * width)
        slot--
      }
      total[slot] = ms
      frame[slot] = at
      rows.set(row, slot * width)
      if (filled < count) filled++
    },
    read(names: readonly string[]) {
      const worst: Array<Record<string, number>> = []
      for (let w = 0; w < filled; w++) {
        const entry: Record<string, number> = { frame: frame[w] }
        for (let c = 0; c < width; c++) entry[names[c]] = rows[w * width + c]
        worst.push(entry)
      }
      return worst
    },
    clear() {
      filled = 0
    },
  }
}

/**
 * The profile of an engine's images, one row of CPU bounds per image and the GPU readbacks that
 * describe images already past. The engine fills `row` as each bound ends (`steps` names them, in
 * order) and files it once with `record`; a bound an image did not run reads `NaN`. Two windows
 * read the filed rows back, a percentile per bound and the slowest images whole (`steps`). When
 * the host mounts the per-stage profile (`stages`), every filed row also deposits each bound onto
 * its stage, and each GPU readback its passes: a ring of durations per stage, CPU side and GPU
 * side, separate and never added. A stage that deposited nothing on the window stays
 * "unmeasured" (`null`); it is never zero. Nothing is allocated per image: rows, rings, sums and
 * the worst tables are typed arrays made once, and the cost of the stage deposits is timed in
 * `overheadMs`.
 */
export function createStageProfiler(options: {
  backend: string
  /** The CPU bounds of an image (`cpuStepTable`). */
  steps: { names: readonly string[]; stages: ReadonlyArray<string | null> }
  /** The stages the profile publishes, in order; absent when the host did not ask for it. */
  stages?: readonly string[]
  gpuMethod: GpuTimingMethod | null
  gpuReason?: string | null
  window?: number
  stepCapacity?: number
  worst?: number
}) {
  const { names } = options.steps
  const width = names.length
  if (!width) throw new Error('STAGE_PROFILER_NO_STEPS')
  const staged = options.stages !== undefined,
    stages = options.stages ?? []
  const capacity = Math.max(8, Math.floor(options.window ?? DEFAULT_WINDOW)),
    stepCapacity = Math.max(1, Math.floor(options.stepCapacity ?? DEFAULT_STEP_CAPACITY)),
    worstCount = Math.max(1, Math.floor(options.worst ?? DEFAULT_WORST))
  const stageIndex = new Map(stages.map((stage, index) => [stage, index]))
  // Stage of each bound in the row, `-1` for a sum or a stage the profile does not publish.
  const stepStage = Int32Array.from(options.steps.stages, (stage) =>
    stage === null ? -1 : (stageIndex.get(stage) ?? -1),
  )

  const row = new Float64Array(width),
    filedRows = new Float64Array(stepCapacity * width),
    windows = {
      published: { opened: 0, worst: createWorst(width, worstCount) },
      host: { opened: 0, worst: createWorst(width, worstCount) },
    }
  let filed = 0

  const cpu = createRings(stages.length, capacity),
    gpu = createRings(stages.length, capacity),
    overhead = createRings(1, capacity),
    image = createRings(1, capacity)
  // A stage may be fed by several bounds of the same image: they are summed here, then deposited
  // once. Without that, the quantiles would mix distinct populations.
  const sums = new Float64Array(stages.length),
    touched = new Uint8Array(stages.length)
  const column = new Float64Array(Math.max(capacity, stepCapacity))
  const counts = new Map<string, Readonly<Record<string, number>>>()
  const gpuReasons = new Map<string, string>(),
    cpuReasons = new Map<string, string>()
  let cpuFrames = 0,
    gpuSamples = 0,
    gpuMethod = options.gpuMethod,
    gpuReason = options.gpuReason ?? null

  const deposit = (at: number, ms: number) => {
    if (at < 0 || !(Number.isFinite(ms) && ms >= 0)) return
    sums[at] += ms
    touched[at] = 1
  }
  const add: StageAdd = (stage, ms) => deposit(stageIndex.get(stage) ?? -1, ms)
  const open = () => {
    sums.fill(0)
    touched.fill(0)
    return performance.now()
  }
  const close = (rings: ReturnType<typeof createRings>, started: number) => {
    for (let at = 0; at < stages.length; at++) if (touched[at]) rings.push(at, sums[at])
    overhead.push(0, performance.now() - started)
  }
  /** p50 and p95 of a stage ring, `null` when it holds nothing. */
  const quantilesOf = (rings: ReturnType<typeof createRings>, at: number): StageQuantiles => {
    const length = rings.filled[at]
    if (!length) return null
    const sorted = column.subarray(0, length)
    sorted.set(rings.data.subarray(at * capacity, at * capacity + length))
    sorted.sort()
    return { p50: quantile(sorted, 0.5)!, p95: quantile(sorted, 0.95)! }
  }

  return {
    /** Whether the per-stage profile is mounted: GPU readbacks are deposited only then. */
    staged,
    /** The current image's CPU bounds, in `steps.names` order, filled before `record`. */
    row,
    /** Files the filled row under `frame`, ranked by `total` in each window's slowest images; with
     *  the stage profile mounted, deposits each bound onto its stage, timing itself. */
    record(frame: number, total: number) {
      filedRows.set(row, (filed % stepCapacity) * width)
      filed++
      windows.published.worst.file(row, frame, total)
      windows.host.worst.file(row, frame, total)
      if (!staged) return
      const started = open()
      for (let c = 0; c < width; c++) deposit(stepStage[c], row[c])
      close(cpu, started)
      cpuFrames++
    },
    /** Deposits the durations of a GPU readback, which describes an image already past. */
    frameGpu(fill: (add: StageAdd) => void) {
      if (!staged) return
      const started = open()
      fill(add)
      close(gpu, started)
      gpuSamples++
    },
    /** Duration of the whole image, on an engine that cannot split it into passes. */
    pushImageGpu(ms: number) {
      if (staged && Number.isFinite(ms) && ms >= 0) image.push(0, ms)
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
    /** Opens the host window and the stage window again: what came before (warmup, first images)
     *  no longer weighs on their quantiles. */
    reset() {
      windows.host.opened = filed
      windows.host.worst.clear()
      cpu.clear()
      gpu.clear()
      overhead.clear()
      image.clear()
      cpuFrames = 0
      gpuSamples = 0
    },
    /** Percentiles of each bound over a window's images, and its slowest images, then forgets the
     *  window. A bound an image did not file (`NaN`) is left out of its quantiles; a bound no image
     *  filed reads `NaN`, never zero. `null` when the window filed no image. */
    steps(name: CpuStepWindow): CpuStepSummary | null {
      const read = windows[name]
      const frames = Math.min(stepCapacity, filed - read.opened)
      if (!frames) return null
      const first = filed - frames
      const summary: CpuStepSummary['steps'] = {}
      for (let c = 0; c < width; c++) {
        let length = 0
        for (let i = 0; i < frames; i++) {
          const ms = filedRows[((first + i) % stepCapacity) * width + c]
          if (Number.isFinite(ms)) column[length++] = ms
        }
        const sorted = column.subarray(0, length).sort()
        summary[names[c]] = {
          p50: length ? quantile(sorted, 0.5)! : NaN,
          p95: length ? quantile(sorted, 0.95)! : NaN,
          max: length ? sorted[length - 1] : NaN,
        }
      }
      const worst = read.worst.read(names)
      read.opened = filed
      read.worst.clear()
      return { frames, steps: summary, worst }
    },
    /** The per-stage profile over the stage window; disabled when the host did not mount it. */
    profile(): StageProfile {
      if (!staged)
        return disabledStageProfile(options.backend, 'per-step profile not requested by the host')
      const entries: StageProfileEntry[] = []
      for (let at = 0; at < stages.length; at++) {
        const stage = stages[at]
        const cpuMs = quantilesOf(cpu, at),
          gpuMs = quantilesOf(gpu, at)
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
        gpuImageMs: quantilesOf(image, 0),
        overheadMs: quantilesOf(overhead, 0),
        stages: entries,
      }
    },
  }
}

export type StageProfiler = ReturnType<typeof createStageProfiler>
