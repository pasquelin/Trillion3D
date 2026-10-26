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
 * The cells may be loaded and not activated: every file stays placed and counted as before, its
 * word zero while the follower says nothing draws (`drawn`, `worldFollow.ts`); the actors always
 * loaded, which no cell holds, stay drawn.
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

/** What the files hold, per slot: its file's key (`key`), its placements, those whose main cell is
 *  wished, those not resident, and whether it is shown; those wished and not shown
 *  (`worldUnshown.ts`), and the slots waiting to be switched again (`worldMarks.ts`). Then the slot
 *  of each file, its rows waiting for a root, the slots given back, those held back; the first slot
 *  never taken, and how many times a slot was taken or given back; the files `settle` keeps hidden
 *  while a load blocks (`holding`), and whether a word moved meanwhile (`changed`); `visit`
 *  switches a slot marked. */
type Files = {
  words: Uint32Array
  instances: number
  drawn: () => boolean
  keyOf: Float64Array
  members: Int32Array
  mains: Int32Array
  uncovered: Int32Array
  shown: Uint8Array
  unshown: ReturnType<typeof createUnshown>
  marks: ReturnType<typeof createMarkStack>
  moved: ReturnType<typeof createChangedRuns>
  slotOf: Map<number, number>
  waitingOf: Map<number, number>
  free: number[]
  heldBack: number[]
  next: number
  slotRevision: number
  holding: ((key: number) => boolean) | undefined
  changed: boolean
  visit: (g: number) => void
}

/** The slot of file `file` of instance `instance`, undefined while no placement lies in it. */
const slotAt = (f: Files, instance: number, file: number) =>
  instance < f.instances ? f.slotOf.get(file * f.instances + instance) : undefined

/** Slot `g` switched as its counts stand, its word written — a file `holding` keeps hidden held
 *  back —; a word that moved is noted in `changed`. */
function settleSlot(f: Files, g: number) {
  const { shown, words } = f
  const wished = f.members[g] > 0 && f.mains[g] === f.members[g],
    loaded = f.uncovered[g] === 0 && !f.waitingOf.get(f.keyOf[g])
  if (shown[g] && !wished) shown[g] = 0
  else if (!shown[g] && wished && loaded) {
    if (f.holding?.(f.keyOf[g])) f.heldBack.push(g)
    else shown[g] = 1
  }
  f.unshown.set(g, wished && !shown[g])
  const word = shown[g] && f.drawn() ? CELL_DRAW.placements : 0
  if (words[g] === word) return
  words[g] = word
  f.moved.mark(g)
  f.changed = true
}

/** The slot of the file `key` names, taken at its first placement. */
function openSlot(f: Files, key: number) {
  const known = f.slotOf.get(key)
  if (known !== undefined) return known
  const g = f.free.pop() ?? f.next++
  f.slotOf.set(key, g)
  f.keyOf[g] = key
  f.members[g] = f.mains[g] = f.uncovered[g] = f.shown[g] = 0
  f.slotRevision++
  f.marks.mark(g)
  return g
}

/** Slot `g` given back once no placement lies in its file. */
function closeSlot(f: Files, g: number) {
  if (f.members[g] > 0) return
  f.slotOf.delete(f.keyOf[g])
  f.shown[g] = 0
  f.unshown.set(g, false)
  f.slotRevision++
  f.free.push(g)
}

/** Every slot waiting switched — those held back asked again, a file `holds` keeps hidden held
 *  back while a load blocks, every one when `all` —; whether a word moved. */
function settleFiles(f: Files, holds: ((key: number) => boolean) | undefined, all: boolean) {
  for (let g = f.heldBack.pop(); g !== undefined; g = f.heldBack.pop()) f.marks.mark(g)
  if (all) for (const g of f.slotOf.values()) f.marks.mark(g)
  f.holding = holds
  f.changed = false
  f.marks.drain(f.visit)
  f.holding = undefined
  return f.changed
}

function createFiles(words: Uint32Array, instances: number, drawn: () => boolean): Files {
  const slots = words.length
  const f: Files = {
    words,
    instances,
    drawn,
    keyOf: new Float64Array(slots),
    members: new Int32Array(slots),
    mains: new Int32Array(slots),
    uncovered: new Int32Array(slots),
    shown: new Uint8Array(slots),
    unshown: createUnshown(slots),
    marks: createMarkStack(slots),
    moved: createChangedRuns(),
    slotOf: new Map(),
    waitingOf: new Map(),
    free: [],
    heldBack: [],
    next: 0,
    slotRevision: 0,
    holding: undefined,
    changed: false,
    visit: (g) => settleSlot(f, g),
  }
  return f
}

/** The files of `instances` instances of the world DAG, their words in `words`, one slot per
 *  placement slot. */
export function createWorldFiles(words: Uint32Array, instances: number, drawn: () => boolean) {
  const f = createFiles(words, instances, drawn)
  return {
    /** The key of file `file` of instance `instance`. */
    key: (file: number, instance: number) => file * instances + instance,
    /** The key of the file whose slot is `g`. */
    keyOf: (g: number) => f.keyOf[g],
    /** The slot of file `file` of instance `instance`, -1 while no placement lies in it. */
    slotIn: (instance: number, file: number) => slotAt(f, instance, file) ?? -1,
    /** Whether file `file` of instance `instance` is shown as its main cell. */
    shownIn(instance: number, file: number) {
      const g = slotAt(f, instance, file)
      return g !== undefined && f.shown[g] === 1
    },
    /** How many times a slot was taken or given back: what names one is stale once it moves. */
    get slotRevision() {
      return f.slotRevision
    },
    open: (key: number) => openSlot(f, key),
    /** Slot `g`'s counts moved by `placements` placements, `wished` of them saying their main cell
     *  is wished, `missing` without their roots resident. */
    count(g: number, placements: number, wished: number, missing: number) {
      f.members[g] += placements
      f.mains[g] += wished
      f.uncovered[g] += missing
      f.marks.mark(g)
    },
    close: (g: number) => closeSlot(f, g),
    /** `by` rows of the file `key` names wait for their root, or no more. */
    wait(key: number, by: number) {
      const count = (f.waitingOf.get(key) ?? 0) + by
      if (count) f.waitingOf.set(key, count)
      else f.waitingOf.delete(key)
      const g = f.slotOf.get(key)
      if (g !== undefined) f.marks.mark(g)
    },
    settle: (holds?: (key: number) => boolean, all = false) => settleFiles(f, holds, all),
    /** Whether every file wished is shown as its main cell. */
    get shown() {
      return f.unshown.none
    },
    /** The words that moved, taken. */
    moved: f.moved,
    /** Bytes of its host tables. */
    get hostBytes() {
      return byteLengths(
        f.keyOf,
        f.members,
        f.mains,
        f.uncovered,
        f.shown,
        f.unshown,
        f.marks,
        f.moved,
      )
    },
  }
}

export type WorldFiles = ReturnType<typeof createWorldFiles>
