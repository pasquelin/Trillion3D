import {
  disabledStageProfile,
  stageLabel,
  stageQuantiles,
  type GpuTimingMethod,
  type StageProfile,
  type StageProfileEntry,
} from '../../../sdk-core/src/index.ts'

/** Default sliding window of the stage profile: two seconds at 60 images per second. */
const DEFAULT_WINDOW = 120
/** Images the CPU bound windows read back, at most. */
const DEFAULT_STEP_CAPACITY = 256
/** Slowest images each CPU bound window keeps, by total. */
const DEFAULT_WORST = 10

/** Deposits `ms` onto the stage at index `at` of the profile's stages. */
export type StageAdd = (at: number, ms: number) => void

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
 * Nothing is allocated per image: the caller fills the scratch row and hands it over.
 */
export type CpuStepSummary = {
  /** Frames measured. */
  frames: number
  /** Time of each step: median, 95th and worst. */
  steps: Record<string, { p50: number; p95: number; max: number }>
  /** The slowest frames, step by step. */
  worst: Array<Record<string, number>>
}

/** A window over the filed images, opened by `openWindow`: `read` summarises the images filed
 *  since it opened and opens it again, `reset` opens it again unread. */
export type CpuStepWindow = {
  read(): CpuStepSummary | null
  reset(): void
}

/** `count` rings of `capacity` recent values each. Order does not matter: only quantiles are read. */
function createRings(count: number, capacity: number) {
  const data = new Float64Array(count * capacity),
    cursor = new Uint32Array(count),
    filled = new Uint32Array(count)
  return {
    push(ring: number, value: number) {
      data[ring * capacity + (cursor[ring] % capacity)] = value
      cursor[ring]++
      if (filled[ring] < capacity) filled[ring]++
    },
    /** The values ring `ring` holds, in no order. */
    values: (ring: number) => data.subarray(ring * capacity, ring * capacity + filled[ring]),
    clear() {
      cursor.fill(0)
      filled.fill(0)
    },
  }
}

/** The slowest images of a window by total, sorted descending, each with its whole row. A sorted
 *  insertion rather than a heap: a few slots (ten by default) shift in place and read in order. */
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
 * The per-stage profile: a ring of durations per stage, CPU side and GPU side, separate and never
 * added. Each filed row deposits its bounds onto their stages (`stepStages`), each GPU readback its
 * passes. A stage that deposited nothing on the window stays "unmeasured" (`null`); it is never
 * zero. Nothing is allocated per image, and the cost of the deposits is timed in `overheadMs`.
 */
function createStageDeposits(options: {
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
    return performance.now()
  }
  const close = (rings: ReturnType<typeof createRings>, started: number) => {
    for (let at = 0; at < stages.length; at++) if (touched[at]) rings.push(at, sums[at])
    overhead.push(0, performance.now() - started)
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

export type StageDeposits = ReturnType<typeof createStageDeposits>

/**
 * The profile of an engine's images, one row of CPU bounds per image and the GPU readbacks that
 * describe images already past. The engine fills `row` as each bound ends (`steps` names them, in
 * order) and files it once with `record`; a bound an image did not run reads `NaN`. Each window a
 * reader opens (`openWindow`) reads the filed rows back, a percentile per bound and the slowest
 * images whole, and forgets on its own read, never for another window. When the host mounts the
 * per-stage profile (`stages`), `stages` is its deposits, which every filed row feeds; absent, the
 * profile publishes itself disabled. Nothing is allocated per image: the row, the ring and the
 * worst tables are typed arrays made once.
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
  const capacity = Math.max(8, Math.floor(options.window ?? DEFAULT_WINDOW)),
    stepCapacity = Math.max(1, Math.floor(options.stepCapacity ?? DEFAULT_STEP_CAPACITY)),
    worstCount = Math.max(1, Math.floor(options.worst ?? DEFAULT_WORST))
  const stageNames = options.stages
  const stages =
    stageNames &&
    createStageDeposits({
      backend: options.backend,
      stages: stageNames,
      stepStages: Int32Array.from(options.steps.stages, (stage) =>
        stage === null ? -1 : stageNames.indexOf(stage),
      ),
      gpuMethod: options.gpuMethod,
      gpuReason: options.gpuReason ?? null,
      capacity,
    })

  const row = new Float64Array(width),
    filedRows = new Float64Array(stepCapacity * width),
    column = new Float64Array(stepCapacity)
  const worstTables: Array<ReturnType<typeof createWorst>> = []
  let filed = 0

  return {
    /** The current image's CPU bounds, in `steps.names` order, filled before `record`. */
    row,
    /** The per-stage deposits, present only when the host mounted the stage profile. */
    stages,
    /** Files the filled row under `frame`, ranked by `total` in each window's slowest images, and
     *  deposits its bounds onto their stages when the stage profile is mounted. */
    record(frame: number, total: number) {
      filedRows.set(row, (filed % stepCapacity) * width)
      filed++
      for (const worst of worstTables) worst.file(row, frame, total)
      stages?.fileRow(row)
    },
    /** Opens a window over the images filed from now on, with slowest images of its own: one per
     *  reader, opened once. */
    openWindow(): CpuStepWindow {
      const worst = createWorst(width, worstCount)
      worstTables.push(worst)
      let opened = filed
      const reset = () => {
        opened = filed
        worst.clear()
      }
      return {
        // Percentiles of each bound over the window's images, and its slowest images. A bound an
        // image did not file (`NaN`) is left out of its quantiles; a bound no image filed reads
        // `NaN`, never zero. `null` when the window filed no image.
        read() {
          const frames = Math.min(stepCapacity, filed - opened)
          if (!frames) return null
          const first = filed - frames
          const steps: CpuStepSummary['steps'] = {}
          for (let c = 0; c < width; c++) {
            let length = 0
            for (let i = 0; i < frames; i++) {
              const ms = filedRows[((first + i) % stepCapacity) * width + c]
              if (Number.isFinite(ms)) column[length++] = ms
            }
            const measured = column.subarray(0, length).sort(),
              quantiles = stageQuantiles(measured)
            steps[names[c]] = quantiles
              ? { ...quantiles, max: measured[length - 1] }
              : { p50: NaN, p95: NaN, max: NaN }
          }
          const summary = { frames, steps, worst: worst.read(names) }
          reset()
          return summary
        },
        reset,
      }
    },
    /** The per-stage profile, or a disabled one when the host did not mount it. */
    profile: (): StageProfile => stages?.profile() ?? disabledStageProfile(options.backend),
  }
}

export type StageProfiler = ReturnType<typeof createStageProfiler>
