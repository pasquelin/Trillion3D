import { resized } from '../../../../math/src/sequence/resized.ts'
import type { IdDelta } from '../cut/delta.ts'

/** A packed id held by the last list applied, and one the list being applied names. */
const HELD = 1,
  NAMED = 2

/**
 * The difference of a plain id list from one readback to the next, read off a mark per id: the
 * ids that entered and those that left, as a cut's difference names them (`IdDelta`), each once
 * however often the list repeats it. Three passes over the two lists, and no record read and no
 * catalogue: what a reader that closes over a difference (`rowDemand.ts`) pays per readback, its
 * closure walking the difference alone. The cut's own difference (`../cut/delta.ts`) also writes
 * the records a list names; a list of ids alone needs none of it.
 */
export function createListDifference() {
  let marks = new Uint8Array(0),
    held = new Int32Array(0),
    /** The list being applied, swapped with `held` once applied: nothing allocated per list. */
    spare = new Int32Array(0)
  const list = {
    entered: new Int32Array(0),
    exited: new Int32Array(0),
    enteredCount: 0,
    exitedCount: 0,
    /** Ids the last list applied holds, each once. */
    count: 0,
    has: (id: number) => marks[id] === HELD,
    /** `ids`, the next list: what entered since the last, and what left. */
    apply(ids: ArrayLike<number>) {
      const entered = (list.entered = resized(list.entered, ids.length)),
        exited = (list.exited = resized(list.exited, list.count)),
        next = (spare = resized(spare, ids.length))
      let nextCount = 0,
        enteredCount = 0,
        exitedCount = 0
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        if (id >= marks.length) marks = resized(marks, id + 1)
        const was = marks[id]
        if (was === NAMED) continue
        if (was !== HELD) entered[enteredCount++] = id
        marks[id] = NAMED
        next[nextCount++] = id
      }
      for (let k = 0; k < list.count; k++)
        if (marks[held[k]] === HELD) {
          exited[exitedCount++] = held[k]
          marks[held[k]] = 0
        }
      for (let k = 0; k < nextCount; k++) marks[next[k]] = HELD
      spare = held
      held = next
      list.count = nextCount
      list.enteredCount = enteredCount
      list.exitedCount = exitedCount
    },
    /** The last list applied, each id once, in its order: its first `count` words. */
    get ids(): Int32Array {
      return held
    },
    /** Bytes of the marks and the lists, the spare included. */
    get hostBytes() {
      return (
        marks.byteLength +
        held.byteLength +
        spare.byteLength +
        list.entered.byteLength +
        list.exited.byteLength
      )
    },
  }
  return list satisfies IdDelta
}
