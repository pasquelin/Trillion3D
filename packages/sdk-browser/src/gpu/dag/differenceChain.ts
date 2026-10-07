import type { CutDifference, CutDifferences } from '../core/selection.ts'
import { DIFFERENCE_HEADER_WORDS, differenceWord } from './readoutWords.ts'
import { createSparseInts, grown } from '../../page/cut/sparseInts.ts'

/** A page's change against the list the host holds: it entered, or it left. */
const ENTERED = 1,
  EXITED = 2

/**
 * One list's changes composed over several snapshots, against the list held before the first: per
 * page, whether it entered or left — a page that entered then left, or left then came back, is
 * unchanged —, and `whole` when some snapshot's difference did not fit its words, or nothing was
 * held to take one against: the host then reads that list whole.
 */
type Composed = {
  readonly changes: ReturnType<typeof createSparseInts>
  whole: boolean
  note(id: number, entered: boolean): void
  take(other: Composed): void
  clear(): void
}

function createComposed(): Composed {
  const changes = createSparseInts()
  const composed: Composed = {
    changes,
    whole: false,
    /** `id` entered (`entered`) or left the list, after what is composed already. */
    note(id: number, entered: boolean) {
      const was = changes.get(id)
      if (was === (entered ? EXITED : ENTERED)) changes.set(id, 0)
      else changes.set(id, entered ? ENTERED : EXITED)
    },
    /** `other`'s changes after these, `other` emptied. */
    take(other: Composed) {
      composed.whole ||= other.whole
      other.changes.forEach((id, change) => composed.note(id, change === ENTERED))
      other.clear()
    },
    clear() {
      changes.clear()
      composed.whole = false
    },
  }
  return composed
}

/** The composed changes as a difference the host applies (`CutDifference`), in `into`. */
function differenceOf(composed: Composed, into: CutDifference) {
  const size = composed.changes.size
  if (into.entered.length < size) into.entered = grown(into.entered, size)
  if (into.exited.length < size) into.exited = grown(into.exited, size)
  let entered = 0,
    exited = 0
  composed.changes.forEach((id, change) => {
    if (change === ENTERED) into.entered[entered++] = id
    else into.exited[exited++] = id
  })
  into.enteredCount = entered
  into.exitedCount = exited
  return into
}

/**
 * EVERY COPIED SNAPSHOT, followed to the list the host holds.
 *
 * The GPU takes each copy's difference against the copy before it (`shader/differenceWgsl.ts`):
 * for each list, the pages that entered and those that left. The host adopts only some copies —
 * another lands before it adopts one, a residency that moved voids one in flight, a truncated one
 * grows the list — and it holds the list of the last it adopted, not of the last copied. Each
 * readback lands here in the order it was copied, and its changes are composed at once through the
 * snapshots since the one the host holds:
 *
 * - a readback the host may not adopt is composed into `since`;
 * - an adoptable one takes `since`, then its own changes, into what the readback in hand changed
 *   against the list held (`held`);
 * - before the host adopts a readback, it holds no GPU snapshot — the bootstrap's list —: it reads
 *   the first whole.
 *
 * Each landing costs its differences alone, its counts and entries read, never its lists: per
 * readback adopted, O(changes of the snapshots since), zero when nothing changed.
 */
export function createDifferenceChain() {
  const since = [createComposed(), createComposed()],
    held = [createComposed(), createComposed()]
  const out: Required<CutDifferences> = {
    asked: {
      entered: new Int32Array(0),
      exited: new Int32Array(0),
      enteredCount: 0,
      exitedCount: 0,
    },
    drawn: {
      entered: new Int32Array(0),
      exited: new Int32Array(0),
      enteredCount: 0,
      exitedCount: 0,
    },
  }
  /** Whether the host holds a GPU snapshot the changes are taken against. */
  let holds = false
  /** Readback `ints`'s list `l`'s changes composed into `into`, its words at `at`. */
  const compose = (into: Composed, ints: Uint32Array, at: number, l: number, listCap: number) => {
    const entered = ints[at + 2 * l],
      exited = ints[at + 2 * l + 1],
      base = at + DIFFERENCE_HEADER_WORDS + l * listCap
    if (entered + exited > listCap) return void (into.whole = true)
    for (let k = 0; k < entered; k++) into.note(ints[base + k], true)
    for (let k = 0; k < exited; k++) into.note(ints[base + listCap - 1 - k], false)
  }
  return {
    /** Lands a readback, `ints` its mapped words, cut on a list of `listCap` ranks; `adoptable`
     *  when it becomes the readback in hand. */
    land(ints: Uint32Array, listCap: number, adoptable: boolean) {
      const at = differenceWord(listCap)
      for (let l = 0; l < 2; l++) {
        compose(since[l], ints, at, l, listCap)
        if (adoptable) held[l].take(since[l])
      }
    },
    /** The host adopts the readback in hand: what each list changed against the list it held, valid
     *  until the next landing — `undefined` for a list it reads whole. */
    adopt() {
      const had = holds
      holds = true
      const differences = {
        asked: had && !held[0].whole ? differenceOf(held[0], out.asked) : undefined,
        drawn: had && !held[1].whole ? differenceOf(held[1], out.drawn) : undefined,
      }
      held.forEach((list) => list.clear())
      return differences
    },
  }
}
