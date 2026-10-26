/**
 * WHERE EACH PLACEMENT OF THE WORLD LIES, AND WHAT EACH CELL AND CELL FILE WAITS ON.
 *
 * A placement row that takes a cell's node — a cell placed — or gives it back — a cell left — tells
 * the cut which HLOD 0 cell and which cell file it lies in, and whether its file's main cell is
 * wished (`place`): its link (`setLink`, `worldLinks.ts`) and its file's counts (`worldFiles.ts`)
 * follow. A row whose root the cut does not hold yet counts in its cell and its file as a placement
 * not resident (`waitRow`). A row of an HLOD cell's instanced actor (`ACTOR_ROW`,
 * `../../hlod/hlodRows.ts`) lies in that cell, in no file, and counts in its actor's readiness.
 *
 * Readiness is counted by difference, moved by the residency changes the cut receives
 * (`residency`): per HLOD cell and instance, its actor's roots not resident and its actor's rows
 * not placed or not resident (`missing`) and, for an HLOD 0 cell, its placements not resident
 * (`unready`) — a row, linked whose root cover is not, or waiting for its root —; per file, the
 * same of its own placements. A placement is counted again once a residency at most: its pages
 * moving together count it once. What moved marks its cell — its parent too, for an actor's roots
 * and rows, whose load counts them — to be switched again (`Marks`).
 */
import type { PageResidency, ResidencyChanges } from '../../../gpu/core/selection.ts'
import type { PackedDag } from '../types.ts'
import { createChangedRuns } from '../../residency/ranges.ts'
import { byteLengths } from '../../../../../math/src/sequence/byteLengths.ts'
import { rootOfPacked } from '../../selection/placements.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { ACTOR_ROW, checkLinkCell, LINK_WORDS, setLink, type PackedWorld } from './worldLinks.ts'
import type { WorldFiles } from './worldFiles.ts'

/** How a count that moved reaches the switch (`worldFollow.ts`): cell slot `at` switched again, or
 *  it and its parent's, whose load counts its actor. */
type Marks = { mark(at: number): void; markWithParent(at: number): void }

/** What the world's placements count in: the tables `createWorldPlacements` hands to the functions
 *  below, with the rows' flags the cut last received and the residencies it received. */
type Tables = {
  packed: PackedDag
  world: PackedWorld
  files: WorldFiles
  marks: Marks
  slots: number
  instances: number
  ranks: number
  instanceOf: Int32Array
  isRoot: Uint8Array
  rootResident: Uint8Array
  missing: Int32Array
  unready: Int32Array
  covered: Uint8Array
  recountedAt: Uint32Array
  fileOf: Int32Array
  mainOf: Uint8Array
  actorOf: Uint8Array
  waiting: Map<object, Map<number, readonly [number, number, boolean]>>
  movedLinks: ReturnType<typeof createChangedRuns>
  rows: PageResidency | undefined
  residencies: number
}

function createTables(
  packed: PackedDag,
  world: PackedWorld,
  files: WorldFiles,
  marks: Marks,
): Tables {
  const { links, cells, roots, rootsOf, rowsOf: actorRows, hlod } = world
  const slots = links.length / LINK_WORDS,
    instances = roots.length,
    ranks = hlod.length
  /** The instance each placement of the world DAG is, -1 for any other. */
  const instanceOf = new Int32Array(Math.max(slots, packed.worldCount)).fill(-1)
  roots.forEach((w, k) => (instanceOf[w] = k))
  /** Whether each world rank is a root that wears a page, and whether it was resident in each
   *  instance. */
  const isRoot = new Uint8Array(ranks)
  for (const list of rootsOf) for (const rank of list) isRoot[rank] = 1
  const rootResident = new Uint8Array(ranks * instances)
  /** Per cell and instance: its actor's roots and rows not resident — its rows, one more while the
   *  partition has not told them placed (`CELL_TOLD.rows`, `worldFollow.ts`) —, and its placements
   *  not resident. */
  const missing = new Int32Array(cells * instances),
    unready = new Int32Array(cells * instances)
  for (let k = 0; k < instances; k++)
    rootsOf.forEach((list, h) => (missing[k * cells + h] = list.length + Math.sign(actorRows[h])))
  return {
    packed,
    world,
    files,
    marks,
    slots,
    instances,
    ranks,
    instanceOf,
    isRoot,
    rootResident,
    missing,
    unready,
    /** Per linked placement: whether its roots were resident as last counted, the residency it was
     *  last counted at, its file's slot (-1 for none), whether it says its main cell is wished, and
     *  whether it is a row of its cell's actor. */
    covered: new Uint8Array(slots),
    recountedAt: new Uint32Array(slots),
    fileOf: new Int32Array(slots).fill(-1),
    mainOf: new Uint8Array(slots),
    actorOf: new Uint8Array(slots),
    /** Per row list, the cell slot and file key each of its rows without a root counts in, -1 for
     *  none, and whether it is a row of its cell's actor (`waitRow`). */
    waiting: new Map(),
    movedLinks: createChangedRuns(),
    /** The rows' flags the cut last received. */
    rows: undefined,
    residencies: 0,
  }
}

/** Whether every root of placement `w`'s cover is resident in the rows last received: a
 *  primitive without its group structure is all roots. */
function coverResident(t: Tables, w: number) {
  const { rows } = t
  if (!rows) return false
  const { structure, pageBase: base, pageCount: count } = t.packed.cutLinks[w]
  if (structure) {
    for (const root of structure.roots) if (!rows.flag(base + root)) return false
    return true
  }
  for (let page = base; page < base + count; page++) if (!rows.flag(page)) return false
  return true
}

/** The cell slot placement `w` counts in, -1 for none: an actor's row of an instance not packed
 *  counts in none. */
function linkedAt(t: Tables, w: number) {
  const { links, cells } = t.world
  const h = links[w * LINK_WORDS],
    k = links[w * LINK_WORDS + 1]
  return h === NO_INDEX || k === NO_INDEX ? -1 : k * cells + (h & ~ACTOR_ROW)
}

/** Cell slot `at` gains `by` placements not resident: a row of its actor (`actor`) in its actor's
 *  readiness — its parent's load counts it —, any other in the cell's. */
function notResident(t: Tables, at: number, actor: boolean | number, by: number) {
  if (!actor) {
    t.unready[at] += by
    t.marks.mark(at)
    return
  }
  t.missing[at] += by
  t.marks.markWithParent(at)
}

/** Placement `w`'s roots counted again, once a residency: its cell's and its file's readiness
 *  moved with them. */
function recount(t: Tables, w: number) {
  const at = linkedAt(t, w),
    g = t.fileOf[w]
  if ((at < 0 && g < 0) || t.recountedAt[w] === t.residencies) return
  t.recountedAt[w] = t.residencies
  const now = coverResident(t, w) ? 1 : 0
  if (t.covered[w] === now) return
  t.covered[w] = now
  if (at >= 0) notResident(t, at, t.actorOf[w], now ? -1 : 1)
  if (g >= 0) t.files.count(g, 0, 0, now ? -1 : 1)
}

/** Packed page `page`'s flag moved, or may have. */
function pageMoved(t: Tables, page: number) {
  const w = rootOfPacked(t.packed.pageIndex, page)
  if (w < 0) return
  const k = t.instanceOf[w]
  if (k < 0) return void recount(t, w)
  const rank = page - t.packed.cutLinks[w].pageBase
  if (!t.isRoot[rank]) return
  const now = t.rows!.flag(page) ? 1 : 0,
    seen = k * t.ranks + rank
  if (t.rootResident[seen] === now) return
  t.rootResident[seen] = now
  const at = k * t.world.cells + t.world.hlod[rank]
  t.missing[at] += now ? -1 : 1
  t.marks.markWithParent(at)
}

/** The rows' flags `next` reach the cut, changed at `changes` (every page without): the
 *  readiness follows. */
function residency(t: Tables, next: PageResidency, changes?: ResidencyChanges) {
  t.rows = next
  t.residencies++
  if (changes) for (let i = 0; i < changes.count; i++) pageMoved(t, changes.pages[i])
  else for (let page = 0; page < next.length; page++) pageMoved(t, page)
}

/** What placement `w` counted in its cell and its file is taken off; the slot of the file it lies
 *  in from now on (`file` of `instance`), the one it stays in kept, -1 for none. */
function leave(t: Tables, w: number, instance: number, file: number) {
  const { files, covered, fileOf, mainOf, actorOf } = t
  const before = linkedAt(t, w),
    was = fileOf[w],
    key = file >= 0 && instance < t.instances ? files.key(file, instance) : -1,
    stays = was >= 0 && files.keyOf(was) === key
  if (before >= 0 && !covered[w]) notResident(t, before, actorOf[w], -1)
  if (was >= 0) files.count(was, -1, -mainOf[w], covered[w] - 1)
  if (was >= 0 && !stays) files.close(was)
  return stays ? was : key >= 0 ? files.open(key) : -1
}

/** Placement `w` lies in HLOD 0 cell `cell` and in cell file `file` of the world DAG's instance
 *  `instance` now — or is a row of cell `cell`'s actor (`actor`), in no file —, or in none
 *  (`-1`), its file's main cell wished (`main`) or not: what it counted moves with it. The file
 *  it stays in keeps its slot. */
function place(
  t: Tables,
  w: number,
  cell: number,
  instance: number,
  file: number,
  main: boolean,
  actor: boolean,
) {
  const { files, world, covered, fileOf, mainOf, actorOf } = t
  // A placement of the world DAG itself lies in no cell; a cell it cannot lie in is refused
  // before anything is counted.
  if (w >= t.slots || t.instanceOf[w] >= 0) return
  checkLinkCell(world, w, cell, actor)
  const g = leave(t, w, instance, file)
  if (setLink(world, w, cell, instance, g < 0 ? NO_INDEX : g, actor)) t.movedLinks.mark(w)
  fileOf[w] = g
  mainOf[w] = main ? 1 : 0
  actorOf[w] = actor ? 1 : 0
  const at = linkedAt(t, w)
  covered[w] = (at >= 0 || g >= 0) && coverResident(t, w) ? 1 : 0
  if (at >= 0 && !covered[w]) notResident(t, at, actor, 1)
  if (g >= 0) files.count(g, 1, mainOf[w], 1 - covered[w])
}

/** What a row counted before in its cell (or actor) and its file, taken off. */
function unwait(t: Tables, before: readonly [number, number, boolean] | undefined) {
  if (!before) return
  if (before[0] >= 0) notResident(t, before[0], before[2], -1)
  if (before[1] >= 0) t.files.wait(before[1], -1)
}

/** Row `index` of the row list `key`, whose root the cut does not hold yet, lies in HLOD 0 cell
 *  `cell` and cell file `file` of instance `instance` — or is a row of cell `cell`'s actor
 *  (`actor`) —, or in none (`-1`, its root held or the row left): until then it counts in that
 *  cell, or that actor, and that file as a placement not resident. */
function waitRow(
  t: Tables,
  key: object,
  index: number,
  cell: number,
  instance: number,
  file: number,
  actor: boolean,
) {
  let rowsOf = t.waiting.get(key)
  const before = rowsOf?.get(index),
    packedHere = instance < t.instances,
    at = cell >= 0 && cell < t.world.cells && packedHere ? instance * t.world.cells + cell : -1,
    owner = file >= 0 && packedHere ? t.files.key(file, instance) : -1
  const same = before?.[2] === actor && before[1] === owner && before[0] === at
  if (same || (!before && at < 0 && owner < 0)) return
  unwait(t, before)
  if (at < 0 && owner < 0) return void rowsOf?.delete(index)
  if (!rowsOf) t.waiting.set(key, (rowsOf = new Map()))
  rowsOf.set(index, [at, owner, actor])
  if (at >= 0) notResident(t, at, actor, 1)
  if (owner >= 0) t.files.wait(owner, 1)
}

/** The links and readiness of `world`'s placements in `packed`, its files counted in `files`. */
export function createWorldPlacements(
  packed: PackedDag,
  world: PackedWorld,
  files: WorldFiles,
  marks: Marks,
) {
  const t = createTables(packed, world, files, marks)
  return {
    missing: t.missing,
    unready: t.unready,
    movedLinks: t.movedLinks,
    residency: (next: PageResidency, changes?: ResidencyChanges) => residency(t, next, changes),
    place: (w: number, cell: number, instance = 0, file = -1, main = false, actor = false) =>
      place(t, w, cell, instance, file, main, actor),
    waitRow: (
      key: object,
      index: number,
      cell: number,
      instance: number,
      file = -1,
      actor = false,
    ) => waitRow(t, key, index, cell, instance, file, actor),
    /** Bytes of its host tables. */
    get hostBytes() {
      return byteLengths(
        t.instanceOf,
        t.isRoot,
        t.rootResident,
        t.missing,
        t.unready,
        t.covered,
        t.recountedAt,
        t.fileOf,
        t.mainOf,
        t.actorOf,
        t.movedLinks,
      )
    },
  }
}
