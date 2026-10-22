import {
  disabledStageProfile,
  type GpuTimingMethod,
  type StageProfile,
} from '../../../../sdk-core/src/runtime/stageProfile.ts'
import { createStageDeposits } from './stageDeposits.ts'
import { createStepWindows } from './stepWindows.ts'

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

/** What a reader of a window holds: `read` and `close`. */
export type CpuStepReader = Pick<CpuStepWindow, 'read' | 'close'>

/** A window over the filed images, opened by `openWindow`: `read` summarises the images filed
 *  since it opened and opens it again, `reset` opens it again unread, `close` stops it filing. */
export type CpuStepWindow = {
  read(): CpuStepSummary | null
  reset(): void
  close(): void
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

  const row = new Float64Array(width)
  const windows = createStepWindows(row, { names, stepCapacity, worstCount })

  return {
    /** The current image's CPU bounds, in `steps.names` order, filled before `record`. */
    row,
    /** The per-stage deposits, present only when the host mounted the stage profile. */
    stages,
    /** Files the filled row under `frame`, ranked by `total` in each window's slowest images, and
     *  deposits its bounds onto their stages when the stage profile is mounted. With `readersOnly`
     *  (the row is filed for the readers alone) only the reader windows' tables rank it and only
     *  reader windows read it back. */
    record(frame: number, total: number, readersOnly = false) {
      windows.record(frame, total, readersOnly)
      stages?.fileRow(row)
    },
    /** The windows opened for a reader of their own (`openWindow(true)`) and not closed: while any
     *  is, the engine files every image's row, debug mode or not. */
    get readers() {
      return windows.readers()
    },
    /** Opens a window over the images filed from now on, with slowest images of its own: one per
     *  reader, opened once. A `reader`'s window asks for the rows to be filed until it closes. */
    openWindow: (reader = false): CpuStepWindow => windows.openWindow(reader),
    /** The per-stage profile, or a disabled one when the host did not mount it. */
    profile: (): StageProfile => stages?.profile() ?? disabledStageProfile(options.backend),
  }
}

export type StageProfiler = ReturnType<typeof createStageProfiler>
