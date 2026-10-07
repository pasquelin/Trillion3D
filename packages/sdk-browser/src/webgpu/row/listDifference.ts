import { grown } from '../../page/cut/sparseInts.ts'
import type { IdDelta } from '../cut/delta.ts'

/** A packed id held by the last list applied, and one the list being applied names. */
const HELD = 1,
  NAMED = 2

/**
 * The difference of one id list from one readback to the next, read off a mark per id: the ids
 * that entered and those that left, as a cut's difference names them (`IdDelta`), each once
 * however often the list repeats it. Three passes over the two lists and no record read: what a
 * reader that closes over a difference (`rowDemand.ts`) pays per readback, its closure walking the
 * difference alone.
 */
export function createListDifference() {
  let marks = new Uint8Array(0),
    held = new Int32Array(0),
    heldCount = 0,
    /** The list being applied, swapped with `held` once applied: nothing allocated per list. */
    spare = new Int32Array(0),
    entered = new Int32Array(0),
    exited = new Int32Array(0)
  const delta: IdDelta = {
    entered,
    exited,
    enteredCount: 0,
    exitedCount: 0,
    has: (id: number) => marks[id] === HELD,
  }
  const mark = (id: number) => {
    if (id >= marks.length) marks = grown(marks, id + 1, marks.length)
    return marks[id]
  }
  return {
    delta,
    /** `ids`, the next list: what entered since the last, and what left. */
    apply(ids: ArrayLike<number>) {
      if (entered.length < ids.length) entered = grown(entered, ids.length)
      if (exited.length < heldCount) exited = grown(exited, heldCount)
      if (spare.length < ids.length) spare = grown(spare, ids.length)
      const next = spare
      let nextCount = 0,
        enteredCount = 0,
        exitedCount = 0
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i],
          was = mark(id)
        if (was === NAMED) continue
        if (was !== HELD) entered[enteredCount++] = id
        marks[id] = NAMED
        next[nextCount++] = id
      }
      for (let k = 0; k < heldCount; k++)
        if (marks[held[k]] === HELD) {
          exited[exitedCount++] = held[k]
          marks[held[k]] = 0
        }
      for (let k = 0; k < nextCount; k++) marks[next[k]] = HELD
      spare = held
      held = next
      heldCount = nextCount
      Object.assign(delta, { entered, exited, enteredCount, exitedCount })
    },
    /** Bytes of the marks and the lists. */
    get bytes() {
      return marks.byteLength + held.byteLength + entered.byteLength + exited.byteLength
    },
  }
}
