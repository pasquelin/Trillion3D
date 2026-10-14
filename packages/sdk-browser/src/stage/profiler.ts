import {
  disabledStageProfile,
  stageQuantiles,
  type GpuTimingMethod,
  type StageProfile,
} from '../../../sdk-core/src/runtime/stageProfile.ts'
import { createWorst } from './stageRings.ts'
import { createStageDeposits } from './stageDeposits.ts'

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
