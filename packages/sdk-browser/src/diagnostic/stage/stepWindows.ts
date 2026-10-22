import { summaryOf } from '../../../../math/src/scalar/quantile.ts'
import { createWorst } from './stageRings.ts'
import type { CpuStepSummary, CpuStepWindow } from './profiler.ts'

/** A ring of filed rows and how many were filed since the start. */
interface RowRing {
  rows: Float64Array
  filed: number
}

/** The shape of the filed rows: the bound names, the ring's depth and the scratch column. */
interface RowShape {
  names: readonly string[]
  stepCapacity: number
  column: Float64Array
}

/** Percentiles of each bound over the `frames` rows of `source` from `first`. A bound an image did
 *  not file (`NaN`) is left out of its quantiles; a bound no image filed reads `NaN`, never zero. */
function stepQuantiles(source: RowRing, first: number, frames: number, shape: RowShape) {
  const { names, stepCapacity, column } = shape
  const width = names.length
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
  return steps
}

/** What the windows share: the two rings, the reader count and every open window's slowest images. */
interface WindowStore {
  profiledRows: RowRing
  allRows: RowRing | null
  readers: number
  worstTables: Array<{ worst: ReturnType<typeof createWorst>; reader: boolean }>
}

/** Opens a window over the images filed from now on, with slowest images of its own. */
function openStepWindow(
  store: WindowStore,
  shape: RowShape,
  ring: () => RowRing,
  worstCount: number,
  reader: boolean,
): CpuStepWindow {
  const { names, stepCapacity } = shape
  const worst = createWorst(names.length, worstCount)
  const table = { worst, reader }
  store.worstTables.push(table)
  if (reader && store.readers++ === 0) store.allRows ??= ring()
  // A reader's window reads every filed row, any other the rows filed while profiled.
  const source = reader ? store.allRows! : store.profiledRows
  let opened = source.filed,
    closed = false
  const reset = () => {
    opened = source.filed
    worst.clear()
  }
  return {
    // `null` when the window filed no image it reads, or is closed.
    read() {
      if (closed) return null
      const frames = Math.min(stepCapacity, source.filed - opened)
      if (!frames) {
        reset()
        return null
      }
      const steps = stepQuantiles(source, source.filed - frames, frames, shape)
      const summary = { frames, steps, worst: worst.read(names) }
      reset()
      return summary
    },
    reset,
    // A closed window's slowest images are no longer kept: nothing of it runs per image.
    close() {
      if (closed) return
      closed = true
      if (reader && --store.readers === 0 && store.allRows) store.allRows.filed = 0
      const at = store.worstTables.indexOf(table)
      if (at >= 0) store.worstTables.splice(at, 1)
    },
  }
}

/**
 * The windows over the rows an engine files: two rings of the filed rows (every row, what a
 * reader's window reads, and the rows filed while profiled, what the others read) and the windows
 * opened over them, each with slowest images of its own. A row filed for the readers alone never
 * enters the second ring, so it cannot push a profiled row out of a window that does not read it.
 */
export function createStepWindows(
  row: Float64Array,
  options: { names: readonly string[]; stepCapacity: number; worstCount: number },
) {
  const { names, stepCapacity, worstCount } = options
  const shape: RowShape = { names, stepCapacity, column: new Float64Array(stepCapacity) }
  const ring = (): RowRing => ({ rows: new Float64Array(stepCapacity * names.length), filed: 0 })
  // The first ring is made by the first reader and kept: with no reader open nothing is copied into
  // it, and the last reader's close only resets its fill counter.
  const store: WindowStore = { profiledRows: ring(), allRows: null, readers: 0, worstTables: [] }
  const file = (filing: RowRing) =>
    filing.rows.set(row, (filing.filed++ % stepCapacity) * names.length)
  return {
    /** Files the filled row under `frame`, ranked by `total` in each window's slowest images. With
     *  `readersOnly` only the reader windows' tables rank it and only reader windows read it. */
    record(frame: number, total: number, readersOnly: boolean) {
      if (store.readers > 0 && store.allRows) file(store.allRows)
      if (!readersOnly) file(store.profiledRows)
      for (const table of store.worstTables)
        if (table.reader || !readersOnly) table.worst.file(row, frame, total)
    },
    /** The windows opened for a reader of their own and not closed. */
    readers: () => store.readers,
    /** Opens a window: one per reader, opened once. A `reader`'s window asks for the rows to be
     *  filed until it closes. */
    openWindow: (reader: boolean) => openStepWindow(store, shape, ring, worstCount, reader),
  }
}
