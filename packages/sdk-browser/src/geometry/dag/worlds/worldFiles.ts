/**
 * EACH CELL FILE OF THE WORLD SHOWN AS ITS MAIN CELL.
 *
 * A row a partition placed lies in a cell file (`RowCell.cell`, `../../partition/rowCells.ts`) of
 * its model's instance, and says whether that file's main grid cell is wished — within the main
 * grid's loading range: its rows then draw the source meshes (`RowCell.proxy` false). Per file and
 * instance, the cut counts its placements (`worldPlacements.ts`): how many there are, how many say
 * their main cell is wished, how many lack a resident root cover, and how many of its rows wait for
 * a root the cut does not hold yet.
 *
 * A file is visible as a streamed main cell is: shown once its main cell is wished — every
 * placement of it says so — and it is loaded — placed, the roots of each of its placements
 * resident and none of its rows waiting —; hidden once its main cell is wished no more. Neither
 * switch waits on a warm-up: the actor a main cell hides or shows is its HLOD 0 actor, the same
 * rows instanced, which asks none. Its word draws its placements while it is shown
 * (`CELL_DRAW.placements`), whatever their HLOD 0 cell draws: that cell's visibility — every file
 * of it loaded — gates the HLOD 0 actor alone (`worldFollow.ts`).
 *
 * The world may be hidden as a whole (`hide`): every file placed and counted as before, its word
 * zero, and no cell draws (`worldFollow.ts`) — what a cell loaded and not activated is.
 *
 * While a load blocks on slow streaming, a file it does not block on stays hidden, wished and
 * loaded, asked again at each sync till the load ends (`settle`). The files wished and not shown are
 * counted: none left, every main cell within range is visible (`shown`).
 *
 * A file takes a word slot while a placement of the cut lies in it, given back with its last: the
 * placements' slots bound them (`PackedWorld.files`). Only the files something moved for are
 * switched again, at each sync, and the words that moved go up with the links.
 */
import { createChangedRuns } from '../../residency/ranges.ts'
import { byteLengths } from '../../../../../math/src/sequence/byteLengths.ts'
import { CELL_DRAW } from './worldLinks.ts'
import { createMarkStack } from './worldMarks.ts'
import { createUnshown } from './worldUnshown.ts'

/** The files of `instances` instances of the world DAG, their words in `words`, one slot per
 *  placement slot. */
export function createWorldFiles(words: Uint32Array, instances: number) {
  const slots = words.length
  /** Per slot: its file's key (`key`), its placements, those whose main cell is wished, those not
   *  resident, and whether it is shown; and those wished and not shown (`worldUnshown.ts`), and
   *  the slots waiting to be switched again (`worldMarks.ts`). */
  const keyOf = new Float64Array(slots),
    members = new Int32Array(slots),
    mains = new Int32Array(slots),
    uncovered = new Int32Array(slots),
    shown = new Uint8Array(slots),
    unshown = createUnshown(slots),
    marks = createMarkStack(slots),
    { mark } = marks
  /** The slot of each file holding one, the rows of each file waiting for their root, the slots
   *  given back, and those a blocking load holds hidden. */
  const slotOf = new Map<number, number>(),
    waitingOf = new Map<number, number>(),
    free: number[] = [],
    heldBack: number[] = []
  /** The first slot never taken, and how many times a slot was taken or given back. */
  let next = 0,
    slotRevision = 0
  const moved = createChangedRuns()
  /** The slot of file `file` of instance `instance`, undefined while no placement lies in it. */
  const slotAt = (instance: number, file: number) =>
    instance < instances ? slotOf.get(file * instances + instance) : undefined
  /** The files `settle` keeps hidden while a load blocks, and whether a word moved meanwhile. */
  let holding: ((key: number) => boolean) | undefined,
    changed = false
  /** Whether the world is hidden as a whole: no file draws, whatever its state (`hide`). */
  let hidden = false
  /** Slot `g` switched as its counts stand, its word written — a file `holding` keeps hidden held
   *  back —; a word that moved is noted in `changed`. */
  const settleSlot = (g: number) => {
    const wished = members[g] > 0 && mains[g] === members[g],
      loaded = uncovered[g] === 0 && !waitingOf.get(keyOf[g])
    if (shown[g] && !wished) shown[g] = 0
    else if (!shown[g] && wished && loaded) {
      if (holding?.(keyOf[g])) heldBack.push(g)
      else shown[g] = 1
    }
    unshown.set(g, wished && !shown[g])
    const word = shown[g] && !hidden ? CELL_DRAW.placements : 0
    if (words[g] === word) return
    words[g] = word
    moved.mark(g)
    changed = true
  }
  return {
    /** The key of file `file` of instance `instance`. */
    key: (file: number, instance: number) => file * instances + instance,
    /** The key of the file whose slot is `g`. */
    keyOf: (g: number) => keyOf[g],
    /** The slot of file `file` of instance `instance`, -1 while no placement lies in it. */
    slotIn: (instance: number, file: number) => slotAt(instance, file) ?? -1,
    /** Whether file `file` of instance `instance` is shown as its main cell. */
    shownIn(instance: number, file: number) {
      const g = slotAt(instance, file)
      return g !== undefined && shown[g] === 1
    },
    /** How many times a slot was taken or given back: what names one is stale once it moves. */
    get slotRevision() {
      return slotRevision
    },
    /** The slot of the file `key` names, taken at its first placement. */
    open(key: number) {
      const known = slotOf.get(key)
      if (known !== undefined) return known
      const g = free.pop() ?? next++
      slotOf.set(key, g)
      keyOf[g] = key
      members[g] = mains[g] = uncovered[g] = shown[g] = 0
      slotRevision++
      mark(g)
      return g
    },
    /** Slot `g`'s counts moved by `placements` placements, `wished` of them saying their main cell
     *  is wished, `missing` without their roots resident. */
    count(g: number, placements: number, wished: number, missing: number) {
      members[g] += placements
      mains[g] += wished
      uncovered[g] += missing
      mark(g)
    },
    /** Slot `g` given back once no placement lies in its file. */
    close(g: number) {
      if (members[g] > 0) return
      slotOf.delete(keyOf[g])
      shown[g] = 0
      unshown.set(g, false)
      slotRevision++
      free.push(g)
    },
    /** `by` rows of the file `key` names wait for their root, or no more. */
    wait(key: number, by: number) {
      const count = (waitingOf.get(key) ?? 0) + by
      if (count) waitingOf.set(key, count)
      else waitingOf.delete(key)
      const g = slotOf.get(key)
      if (g !== undefined) mark(g)
    },
    /** The world hidden as a whole, or drawn again: every file's word written again; whether that
     *  moved. */
    hide(on: boolean) {
      if (hidden === on) return false
      hidden = on
      for (const g of slotOf.values()) mark(g)
      return true
    },
    /** Whether the world is hidden as a whole. */
    get hidden() {
      return hidden
    },
    /** Every slot waiting switched — those held back asked again, a file `holds` keeps hidden held
     *  back while a load blocks —; whether a word moved. */
    settle(holds?: (key: number) => boolean) {
      for (let g = heldBack.pop(); g !== undefined; g = heldBack.pop()) mark(g)
      holding = holds
      changed = false
      marks.drain(settleSlot)
      holding = undefined
      return changed
    },
    /** Whether every file wished is shown as its main cell. */
    get shown() {
      return unshown.none
    },
    /** The words that moved, taken. */
    moved,
    /** Bytes of its host tables. */
    get hostBytes() {
      return byteLengths(keyOf, members, mains, uncovered, shown, unshown, marks, moved)
    },
  }
}

export type WorldFiles = ReturnType<typeof createWorldFiles>
