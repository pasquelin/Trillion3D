/**
 * EVERY HLOD CELL'S VISIBILITY, AND WHAT DRAWS FOR IT.
 *
 * A placement row that takes a cell's node or gives it back tells the cut which HLOD 0 cell and
 * which cell file it lies in, and whether that file's main cell is wished (`placeInCell`); a row
 * whose root the cut does not hold yet counts in its cell and its file as a placement not resident
 * (`waitRow`): what each cell and file waits on is counted apart (`worldPlacements.ts`). Each frame
 * the partition tells each HLOD cell whether it is wished — within its grid's loading range —, for
 * an HLOD 0 cell whether every cell file of it is placed or one is refused for good, whether its
 * actor's hold failed for good, and its actor's rows placed (`show`, `../../hlod/hlodCells.ts`).
 *
 * Each cell is visible or not, as a streamed cell is: it turns visible once wished and loaded — an
 * HLOD 0 cell every cell file of it placed and its placements resident; a cell above it each actor
 * of its children resident, an actor not built or whose hold failed waiting for nothing —, once the
 * actors in it that ask for a warm-up have had theirs; it turns invisible once wished no more, once
 * its own actor, loaded, has had its warm-up. A cell's actor draws while the cell it lies in — its
 * parent; none for an actor always loaded — is visible and the cell is not: the cell shown hides
 * its actor at once, the cell hidden shows it if it is loaded. Nothing else orders the switches:
 * a cell and the cells below it switch each on its own, as their loads end.
 *
 * A warm-up (`warmWith`, `worldWarm.ts`, `../../../frame/prepare/hlodWarm.ts`) asks an actor's
 * geometry, and its textures at the size it covers on screen, for so many frames in a row, its
 * switch held till they pass; every actor of a switching cell asked at once. It ends once the actor
 * is drawn or let go (`ActorWarmth.release`): the cell it lies in shown or hidden, the cell it
 * stands for hidden, or the cell it lies in wished no more while hidden — its actors' hold let go.
 * No switch waits on one during the initial load — till the first image is shown
 * (`firstImageShown`) —, nor while a load blocks on slow streaming (`blockingLoad`), when no cell
 * turns visible, nor any cell file but those the load waits for. The HLOD actors off
 * (`hlodEnabled`), no cell draws its actor nor its HLOD 0 actor.
 *
 * What draws is then: a cell's actor as above; a visible HLOD 0 cell's placements — its HLOD 0
 * actor, the source meshes instanced —; and the placements of a cell file shown as its main cell,
 * whatever their HLOD 0 cell draws (`worldFiles.ts`). The cells and files wished and not yet shown
 * are counted as they switch (`worldUnshown.ts`): none left, everything within range shows
 * (`shown`) — but a cell whose cell file was refused for good (`CELL_TOLD.lost`).
 *
 * Only the cells something moved for switch again — a cell's parent when its actor's readiness or
 * its word moved, its children when it switched. The words that moved go up behind the cold
 * records before the next cut, joined by the cut's one run writer (`../runWrites.ts`): the cut made
 * before them is then not the cut made now (`../runtime/runtime.ts`).
 */
import type { PackedDag } from '../types.ts'
import { writeRanges, type RangeTarget } from '../runWrites.ts'
import { createChangedRuns } from '../../residency/ranges.ts'
import { CELL_DRAW, LINK_WORDS, cellChildren } from './worldLinks.ts'
import { CHAIN_ACTOR } from '../../../../../sdk-core/src/manifest/worldRoots.ts'
import { byteLengths } from '../../../../../math/src/sequence/byteLengths.ts'
import { createMarkStack } from './worldMarks.ts'
import { createWorldFiles } from './worldFiles.ts'
import { createWorldPlacements } from './worldPlacements.ts'
import { createSwitchedPages } from './worldSwitched.ts'
import { createSwitchWarmth } from './worldWarm.ts'
import { createVisibilityMoves } from './worldMoves.ts'
import { createUnshown } from './worldUnshown.ts'

/** What the partition tells of a cell (`show`), bit by bit: wished, every cell file of an HLOD 0
 *  cell placed, its actor's hold failed for good — it stands for nothing —, a file of it refused
 *  for good — never placed whole: nothing waits for its content (`shown`) —, its rows placed. */
export const CELL_TOLD = { wished: 1, placed: 2, failed: 4, lost: 8, rows: 16 } as const

/** The follower of the world's cells in `packed`'s cold words; none without a world DAG. A member
 *  of the run (`../runtime/runtime.ts`): `placeInCell` moves a link, `waitRow` a row without its
 *  root, `show` what a cell is told, every residency the cut receives moves the readiness
 *  (`residency`), and every cut takes the moves up first (`sync`). */
export function createLinkFollower(resources: { packed: PackedDag; cold: RangeTarget }) {
  const { packed, cold } = resources,
    world = packed.world
  if (!world) return undefined
  const { links, states, cells, roots, rootsOf, rowsOf, parent, layer, actor } = world
  const instances = roots.length
  /** Each cell's children: the cells whose actors lie in it. */
  const below = cellChildren(parent)
  /** Per cell and instance: what it was told (`CELL_TOLD`), and whether it is visible. */
  const told = new Uint8Array(cells * instances),
    visible = new Uint8Array(cells * instances)
  /** The cell slots wished and not visible at their last switch — an actor drawn for them, or
   *  nothing —, their content not lost (`CELL_TOLD.lost`); per instance, the cell files a load
   *  blocking on slow streaming waits for (`blockingLoad`). */
  const unshown = createUnshown(cells * instances),
    blockOn: (ReadonlySet<number> | undefined)[] = []
  /** The cell slots waiting to be switched again: every one at first, its word written. */
  const marks = createMarkStack(cells * instances),
    { mark } = marks
  /** How many times a cell's or a file's visibility moved. */
  let revision = 0
  /** The cells whose visibility moved, per instance (`worldMoves.ts`), and the words moved. */
  const moves = createVisibilityMoves(instances, cells),
    movedStates = createChangedRuns()
  const linkWords = { data: links, sourceBase: 0, targetBase: world.linkBase, stride: LINK_WORDS },
    stateWords = { data: states, sourceBase: 0, targetBase: world.stateBase, stride: 1 },
    fileWords = { data: world.files, sourceBase: 0, targetBase: world.fileBase, stride: 1 }
  /** The warm-ups the switches that draw an actor wait on (`worldWarm.ts`). */
  const warmth = createSwitchWarmth(actor, cells)
  /** Cell slot `at` waits to be switched again, and its parent's, whose load counts its actor. */
  const markWithParent = (at: number) => {
    mark(at)
    const cell = at % cells
    if (parent[cell] >= 0) mark(at - cell + parent[cell])
  }
  /** Every cell slot waits to be switched again. */
  const markAll = () => {
    for (let at = cells * instances - 1; at >= 0; at--) mark(at)
  }
  markAll()
  /** The cell files (`worldFiles.ts`), the placements' links and what each cell and file waits on
   *  (`worldPlacements.ts`), and the pages the switches moved (`worldSwitched.ts`). */
  const files = createWorldFiles(world.files, instances),
    placed = createWorldPlacements(packed, world, files, { mark, markWithParent }),
    { missing, unready } = placed,
    switchedPages = createSwitchedPages(packed, world)
  /** Whether the file `key` names stays hidden while a load blocks: one it does not wait for. */
  const heldBack = (key: number) => !blockOn[key % instances]?.has(Math.floor(key / instances))
  /** The actors in cell `cell` at `base` — its children's — drawn or let go. */
  const releaseIn = (base: number, cell: number) => {
    for (const child of below[cell]) warmth.release(base, child)
  }
  /** Whether cell `cell` at `base` has an actor to wait for: built, with a root that wears a page
   *  or a row, its hold not failed for good; one not built, or failed, stands for nothing. */
  const usable = (base: number, cell: number) =>
    (actor[cell] & CHAIN_ACTOR.built) !== 0 &&
    (rootsOf[cell].length > 0 || rowsOf[cell] > 0) &&
    (told[base + cell] & CELL_TOLD.failed) === 0
  /** Whether cell `cell` at `base` is loaded: an HLOD 0 cell every cell file of it placed and its
   *  placements resident; a cell above it each actor of its children resident. */
  const loaded = (base: number, cell: number) => {
    const at = base + cell
    if (layer[cell] === 0) return (told[at] & CELL_TOLD.placed) !== 0 && unready[at] === 0
    for (const child of below[cell])
      if (usable(base, child) && missing[base + child] !== 0) return false
    return true
  }
  /** Whether cell `cell` at `base` may turn visible: the actors in it — its children's — warmed up,
   *  every one asked, none left for the next. */
  const warmedIn = (base: number, cell: number) => {
    let ready = true
    for (const child of below[cell])
      if (usable(base, child)) ready = warmth.ready(base, child, cell, base + cell) && ready
    return ready
  }
  /** Whether cell `cell` at `base` may turn invisible: its own actor warmed up, when loaded — its
   *  parent visible, or none, the actor always loaded. */
  const warmedOut = (base: number, cell: number) => {
    const up = parent[cell]
    if (!usable(base, cell) || (up >= 0 && !visible[base + up])) return true
    return warmth.ready(base, cell, cell, base + cell)
  }
  /** Cell slot `at` switched where it may, its word written; its children switched again once it
   *  switched — their actors draw as it shows or hides. */
  const settle = (at: number) => {
    const cell = at % cells,
      base = at - cell,
      up = parent[cell]
    const wished = (told[at] & CELL_TOLD.wished) !== 0
    const was = visible[at]
    if (was && !wished && warmedOut(base, cell)) visible[at] = 0
    else if (!was && wished && !warmth.blocking && loaded(base, cell) && warmedIn(base, cell))
      visible[at] = 1
    // The HLOD actors off, no cell draws its actor, nor its placements as its HLOD 0 actor.
    const within = up < 0 || visible[base + up] === 1,
      on = warmth.hlodOn
    const stands = on && !visible[at] && within ? CELL_DRAW.hlod : 0
    const own = on && layer[cell] === 0 && visible[at] ? CELL_DRAW.placements : 0
    if (states[at] !== (stands | own)) {
      switchedPages.cellMoved(at, states[at] ^ (stands | own))
      states[at] = stands | own
      movedStates.mark(at)
    }
    unshown.set(at, wished && !visible[at] && (told[at] & CELL_TOLD.lost) === 0)
    if (visible[at] === was) {
      // Hidden and wished no more, it lets the actors in it go.
      if (!visible[at] && !wished) releaseIn(base, cell)
      return
    }
    // Shown, it draws the actors in it; hidden, it lets them go and shows its own.
    releaseIn(base, cell)
    if (!visible[at]) warmth.release(base, cell)
    revision++
    moves.note(base / cells, cell)
    for (const child of below[cell]) mark(base + child)
  }
  /** The words `moved` names of `words`, sent. */
  const send = (moved: ReturnType<typeof createChangedRuns>, words: typeof linkWords) => {
    if (!moved.count) return
    const sorted = moved.take()
    writeRanges(cold, sorted, sorted.length, words)
  }
  return {
    /** The rows' flags `next` reach the cut, changed at `changes` (every page without): the
     *  readiness follows (`worldPlacements.ts`). */
    residency: placed.residency,
    /** Placement `w` lies in HLOD 0 cell `cell` and cell file `file` of the world DAG's instance
     *  `instance` now — or is a row of `cell`'s actor (`actor`) —, or in none (`-1`), its file's
     *  main cell wished (`main`) or not: what it counted moves with it (`worldPlacements.ts`). */
    placeInCell: placed.place,
    /** Row `index` of the row list `key`, whose root the cut does not hold yet, lies in HLOD 0 cell
     *  `cell` — or is a row of its actor — and cell file `file` of instance `instance`, or in none:
     *  until then it counts there as a placement not resident (`worldPlacements.ts`). */
    waitRow: placed.waitRow,
    /** HLOD cell `cell` of instance `instance` is told `word` (`CELL_TOLD`); whether it moved. */
    show(instance: number, cell: number, word: number) {
      if (instance >= instances || cell >= cells) return false
      const at = instance * cells + cell
      if (told[at] === word) return false
      // Its actor's rows placed or parked count in its readiness (`worldPlacements.ts`).
      if ((told[at] ^ word) & CELL_TOLD.rows) missing[at] += word & CELL_TOLD.rows ? -1 : 1
      told[at] = word
      // Its parent's load counts its actor, whose hold may have failed.
      markWithParent(at)
      return true
    },
    /** Whether cell `cell` of instance `instance` was visible at the last cut. */
    visible: (instance: number, cell: number) =>
      instance < instances && cell < cells && visible[instance * cells + cell] === 1,
    /** Whether cell file `file` of instance `instance` was shown at the last cut, the slot of its
     *  word (-1 for none), and how many times a file took a slot or gave one back (`worldFiles.ts`). */
    fileShown: files.shownIn,
    fileSlot: files.slotIn,
    get slotRevision() {
      return files.slotRevision
    },
    /** The packed page of world rank 0 in instance `instance`: its rank `r` is packed page
     *  `pageBase(instance) + r`. */
    pageBase: (instance: number) => packed.cutLinks[roots[instance]].pageBase,
    /** A switch that draws an actor waits until the warm-up given says it passed, asked again at
     *  each cut while it waits; none, it waits for nothing past its loads. */
    warmWith: warmth.warmWith,
    /** Whether a switch waits on an actor's warm-up: the view keeps drawing till it is done. */
    get warming() {
      return warmth.warming
    },
    /** The session's first image is shown (`../../../frame/loop/firstImage.ts`): the initial load
     *  ends, and a switch waits on a warm-up from now on. */
    firstImageShown: warmth.firstImageShown,
    /** The HLOD actors on or off (`hlodEnabled`): every cell's word written again. */
    hlodEnabled(on: boolean) {
      if (warmth.hlodEnabled(on)) markAll()
    },
    /** The cell files of instance `instance` a load blocking on slow streaming waits for, read as
     *  they stand at each sync, none once it blocks no more: the cells it kept hidden then switch
     *  again. */
    blockingLoad(instance: number, waits: ReadonlySet<number>) {
      if (instance >= instances) return
      blockOn[instance] = waits
      const on = blockOn.some((files) => !!files?.size)
      if (warmth.blockingLoad(on) && !on) markAll()
    },
    /** Whether every cell and every cell file wished shows its own content, as the last cut
     *  switched them — none drawn by an actor, none drawing nothing, but a cell whose content is
     *  lost (`CELL_TOLD.lost`) —, and no cell waits to be switched again: what the session's first
     *  image waits for (`../../../frame/loop/firstImage.ts`). */
    get shown() {
      return unshown.none && files.shown && marks.count === 0
    },
    /** Each cell of instance `instance` whose visibility moved since the last call for it. */
    moved: moves.moved,
    /** Advanced whenever a cell's or a file's visibility moved. */
    get revision() {
      return revision
    },
    /** Before every cut: the cells and files waiting switched — those whose switch waits on an
     *  actor warming asked again —, the links and words that moved go up; whether any did. */
    sync() {
      warmth.again(mark)
      marks.drain(settle)
      if (files.settle(warmth.blocking ? heldBack : undefined)) {
        switchedPages.fileMoved()
        revision++
      }
      const moved = placed.movedLinks.count + movedStates.count + files.moved.count > 0
      send(placed.movedLinks, linkWords)
      send(movedStates, stateWords)
      send(files.moved, fileWords)
      return moved
    },
    /** Each page whose drawing a switch moved since the last call, told to `visit` by its placement
     *  and its rank there (`worldSwitched.ts`). */
    switched: switchedPages.take,
    /** Bytes of its host tables. */
    get hostBytes() {
      return (
        byteLengths(told, visible, marks, unshown, movedStates) +
        placed.hostBytes +
        files.hostBytes +
        switchedPages.hostBytes
      )
    },
  }
}

export type LinkFollower = NonNullable<ReturnType<typeof createLinkFollower>>
