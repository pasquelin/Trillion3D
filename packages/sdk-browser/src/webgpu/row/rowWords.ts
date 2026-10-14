import { createChangedRuns } from '../residency/ranges.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { BufferMaker } from '../../gpu/dag/cutBuffers.ts'

/** Words of a row's use: its last use, its walk gate, its page (`rowClosureWgsl.ts`). */
export const ROW_USE_WORDS = 3
/** Word ranks inside a row's use. */
export const ROW_USE = 0,
  ROW_WALK = 1,
  ROW_PAGE = 2

/**
 * THE ROWS' USE WORDS (#1527), three per visibility row: `use`, the last frame a cut drew, asked or
 * asked ahead a page whose per-instance closure holds the row's page — raised by the GPU alone with
 * `atomicMax` (`rowClosureWgsl.ts`) —; `walk`, the gate one walk per placement and group takes each
 * frame; `page`, the occupant the victim queue names (`rowEvictSortWgsl.ts`).
 *
 * The host writes a row's words only when its occupant changes or a request takes it, never reads
 * them back, and sends them before the frame's commands: a new occupant was never walked (`walk`
 * 0) and is used now when a request took it, at 0 — the first to go — when no cut asked for it; a
 * row moved into a hole (`writers.ts`, `closeHoles`) counts as used now, so a move never shortens
 * its protection. Only the rows written are sent, each run of neighbours once and no row between:
 * the GPU's stamps on the others stand.
 *
 * Each row keeps on the host the pool's arrival count when its occupant came (`generation`), moved
 * with it: a page that took its row after a queue's cut is never that queue's victim
 * (`../../gpu/pool/slotOrder.ts`).
 */
export function createRowWords() {
  let words: Uint32Array<ArrayBuffer> = new Uint32Array(ROW_USE_WORDS),
    generations = new Int32Array(1),
    arrivals = 0,
    whole = true
  const dirty = createChangedRuns()
  const write = (row: number, use: number, page: number) => {
    const at = row * ROW_USE_WORDS
    words[at + ROW_USE] = use
    words[at + ROW_WALK] = 0
    words[at + ROW_PAGE] = page
    dirty.mark(row)
  }
  return {
    /** Row `row` takes `page`, used at `use`: the clock for a request, 0 for an arrival. */
    assign(row: number, page: number, use: number) {
      write(row, use, page)
      generations[row] = ++arrivals
    },
    /** Row `row`'s occupant was asked for again by a request: used at `clock`. */
    stamp(row: number, clock: number) {
      write(row, clock, words[row * ROW_USE_WORDS + ROW_PAGE])
    },
    /** Row `from` moved to the free rank `to`, its generation with it, used at `clock`. */
    moved(from: number, to: number, clock: number) {
      generations[to] = generations[from]
      write(to, clock, words[from * ROW_USE_WORDS + ROW_PAGE])
    },
    /** The arrival count row `row`'s occupant came at. */
    generationOf: (row: number) => generations[row],
    /** Occupants the rows took since the table was made. */
    get arrivals() {
      return arrivals
    },
    /** The table holds `rows` visibility rows: the words grow, and are sent whole. */
    fit(rows: number) {
      if (generations.length >= rows) return
      words = resized(words, rows * ROW_USE_WORDS)
      generations = resized(generations, rows)
      whole = true
    },
    /** The rows `[0, count)` as the host wrote them, sent whole: a buffer made anew holds no stamp.
     *  Every live row counts as used at `clock`, so none loses its protection. */
    rewriteAll(count: number, clock: number) {
      for (let row = 0; row < count; row++) words[row * ROW_USE_WORDS + ROW_USE] = clock
      whole = true
    },
    /** Sends what the host wrote through `send(firstRow, words)`, run by run, or every row of
     *  `[0, count)` when they are owed whole; nothing when nothing was written. */
    flush(count: number, send: (row: number, data: Uint32Array<ArrayBuffer>) => void) {
      if (whole) {
        whole = false
        dirty.clear()
        if (count) send(0, words.subarray(0, count * ROW_USE_WORDS))
        return
      }
      if (!dirty.count) return
      const { count: runs, pairs } = dirty.runs()
      for (let r = 0; r < runs; r++)
        send(
          pairs[2 * r],
          words.subarray(pairs[2 * r] * ROW_USE_WORDS, (pairs[2 * r + 1] + 1) * ROW_USE_WORDS),
        )
      dirty.clear()
    },
    /** Bytes the host holds: the words and the generations. */
    get bytes() {
      return words.byteLength + generations.byteLength + dirty.byteLength
    },
  }
}

export type RowWords = ReturnType<typeof createRowWords>

/**
 * The GPU buffer of the rows' use words, `ROW_USE_WORDS` a row over the visibility rows: made for
 * the rows the table holds, made anew when it grows — every live row then sent whole, used now
 * (`rewriteAll`). `upload` sends the host's writes before the frame's commands and says whether
 * the buffer was made anew: the bind groups follow.
 */
export function createRowWordsGpu(
  device: Pick<GPUDevice, 'queue'>,
  /** Makes its buffer, in place of the one it outgrew: the cut's (`cutBuffer`). */
  make: BufferMaker,
) {
  let buffer: GPUBuffer | undefined
  return {
    upload(words: RowWords, rows: number, count: number, clock: number) {
      const bytes = Math.max(1, rows) * ROW_USE_WORDS * 4
      let made = false
      if (!buffer || buffer.size < bytes) {
        const old = buffer
        buffer = make(
          {
            label: 'Trillion3D DAG row use',
            size: bytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          },
          old,
        )
        old?.destroy()
        words.rewriteAll(count, clock)
        made = true
      }
      const target = buffer
      words.flush(count, (row, data) =>
        device.queue.writeBuffer(target, row * ROW_USE_WORDS * 4, data),
      )
      return made
    },
    /** The buffer the closure and the sort bind, made at the first `upload`. */
    get buffer() {
      return buffer
    },
  }
}
