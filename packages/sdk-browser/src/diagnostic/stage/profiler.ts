import {
  disabledStageProfile,
  type GpuTimingMethod,
  type StageProfile,
} from '../../../../sdk-core/src/runtime/stageProfile.ts'
import { summaryOf } from '../../../../math/src/scalar/quantile.ts'
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

  const row = new Float64Array(width),
    column = new Float64Array(stepCapacity)
  // Two rings of the filed rows: every row (what a reader's window reads) and the rows filed while
  // profiled (what the others read). A row filed for the readers alone never enters the second, so
  // it cannot push a profiled row out of a window that does not read it.
  const ring = () => ({ rows: new Float64Array(stepCapacity * width), filed: 0 })
  const profiledRows = ring()
  // The first ring is made by the first reader and kept: with no reader open nothing is copied into
  // it, and the last reader's close only resets its fill counter.
  let allRows: ReturnType<typeof ring> | null = null
  const file = (filing: ReturnType<typeof ring>) =>
    filing.rows.set(row, (filing.filed++ % stepCapacity) * width)
  const worstTables: Array<{ worst: ReturnType<typeof createWorst>; reader: boolean }> = []
  let readers = 0

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
      if (readers > 0 && allRows) file(allRows)
      if (!readersOnly) file(profiledRows)
      for (const table of worstTables)
        if (table.reader || !readersOnly) table.worst.file(row, frame, total)
      stages?.fileRow(row)
    },
    /** The windows opened for a reader of their own (`openWindow(true)`) and not closed: while any
     *  is, the engine files every image's row, debug mode or not. */
    get readers() {
      return readers
    },
    /** Opens a window over the images filed from now on, with slowest images of its own: one per
     *  reader, opened once. A `reader`'s window asks for the rows to be filed until it closes. */
    openWindow(reader = false): CpuStepWindow {
      const worst = createWorst(width, worstCount)
      const table = { worst, reader }
      worstTables.push(table)
      if (reader && readers++ === 0) allRows ??= ring()
      // A reader's window reads every filed row, any other the rows filed while profiled.
      const source = reader ? allRows! : profiledRows
      let opened = source.filed,
        closed = false
      const reset = () => {
        opened = source.filed
        worst.clear()
      }
      return {
        // Percentiles of each bound over the window's images, and its slowest images. A bound an
        // image did not file (`NaN`) is left out of its quantiles; a bound no image filed reads
        // `NaN`, never zero. `null` when the window filed no image it reads, or is closed.
        read() {
          if (closed) return null
          const frames = Math.min(stepCapacity, source.filed - opened)
          const first = source.filed - frames
          if (!frames) {
            reset()
            return null
          }
          const steps: CpuStepSummary['steps'] = {}
          for (let c = 0; c < width; c++) {
            let length = 0
            for (let i = 0; i < frames; i++) {
              const ms = source.rows[((first + i) % stepCapacity) * width + c]
              if (Number.isFinite(ms)) column[length++] = ms
            }
            // One sort for the quantiles and the maximum (`summaryOf`).
            const summary = summaryOf(column.subarray(0, length))
            steps[names[c]] = summary
              ? { p50: summary.p50, p95: summary.p95, max: summary.max }
              : { p50: NaN, p95: NaN, max: NaN }
          }
          const summary = { frames, steps, worst: worst.read(names) }
          reset()
          return summary
        },
        reset,
        // A closed window's slowest images are no longer kept: nothing of it runs per image.
        close() {
          if (closed) return
          closed = true
          if (reader && --readers === 0 && allRows) allRows.filed = 0
          const at = worstTables.indexOf(table)
          if (at >= 0) worstTables.splice(at, 1)
        },
      }
    },
    /** The per-stage profile, or a disabled one when the host did not mount it. */
    profile: (): StageProfile => stages?.profile() ?? disabledStageProfile(options.backend),
  }
}

export type StageProfiler = ReturnType<typeof createStageProfiler>
