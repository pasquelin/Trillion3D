import { grown } from '../../page/cut/sparseInts.ts'
import type { IdDelta } from '../cut/delta.ts'

/** A packed id held by the last list applied, and one the list being applied names. */
const HELD = 1,
  NAMED = 2

/**
 * One id list as a set followed from one readback to the next, and what it changed (`IdDelta`):
 * by the changes another difference already took (`applyChanges`, O(changes)), or by a whole list
 * against the set held (`apply`, three passes over the two lists and no record read) — a list
 * nothing took the changes of, as a view's that changed. Each id is held once however often a list
 * repeats it. What a reader that closes over a difference (`rowDemand.ts`) pays per readback.
 */
export function createListDifference() {
  let marks = new Uint8Array(0),
    held = new Int32Array(0),
    heldCount = 0,
    /** Each held id's rank in `held` plus one, kept while changes alone are applied. */
    slots = new Int32Array(0),
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
  const fit = (id: number) => {
    if (id < marks.length) return
    marks = grown(marks, id + 1, marks.length)
    slots = grown(slots, id + 1, slots.length)
  }
  const publish = (enteredCount: number, exitedCount: number) =>
    Object.assign(delta, { entered, exited, enteredCount, exitedCount })
  return {
    delta,
    /** `ids`, the next list whole: what entered since the last, and what left. */
    apply(ids: ArrayLike<number>, count = ids.length) {
      if (entered.length < count) entered = grown(entered, count)
      if (exited.length < heldCount) exited = grown(exited, heldCount)
      if (spare.length < count) spare = grown(spare, count)
      const next = spare
      let nextCount = 0,
        enteredCount = 0,
        exitedCount = 0
      for (let i = 0; i < count; i++) {
        const id = ids[i]
        fit(id)
        const was = marks[id]
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
      for (let k = 0; k < nextCount; k++) {
        marks[next[k]] = HELD
        slots[next[k]] = k + 1
      }
      spare = held
      held = next
      heldCount = nextCount
      publish(enteredCount, exitedCount)
    },
    /** The changes `changes` names, another difference's: the set follows them alone. */
    applyChanges(changes: IdDelta) {
      const { enteredCount: entering, exitedCount: exiting } = changes
      if (entered.length < entering) entered = grown(entered, entering)
      if (exited.length < exiting) exited = grown(exited, exiting)
      if (held.length < heldCount + entering) held = grown(held, heldCount + entering, heldCount)
      let enteredCount = 0,
        exitedCount = 0
      for (let k = 0; k < exiting; k++) {
        const id = changes.exited[k]
        if (marks[id] !== HELD) continue
        const slot = slots[id] - 1,
          moved = held[--heldCount]
        held[slot] = moved
        slots[moved] = slot + 1
        marks[id] = 0
        exited[exitedCount++] = id
      }
      for (let k = 0; k < entering; k++) {
        const id = changes.entered[k]
        fit(id)
        if (marks[id] === HELD) continue
        marks[id] = HELD
        held[heldCount] = id
        slots[id] = ++heldCount
        entered[enteredCount++] = id
      }
      publish(enteredCount, exitedCount)
    },
    /** Bytes of the marks, the ranks and the lists. */
    get bytes() {
      return (
        marks.byteLength +
        slots.byteLength +
        held.byteLength +
        spare.byteLength +
        entered.byteLength +
        exited.byteLength
      )
    },
  }
}
