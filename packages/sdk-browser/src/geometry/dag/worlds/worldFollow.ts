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
 * (`hlodEnabled`), no cell draws its actor nor its HLOD 0 actor; the cells only loaded
 * (`activated`), none is shown — each cell and file stays loaded, wished and counted as it is, its
 * word zero —, so an actor draws wherever its cell is not shown, and the actors always loaded,
 * which no cell holds, over every cell, wished or not; those held in a cell draw as that cell,
 * which is not shown, says.
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
import { writeRanges, type RangeSource, type RangeTarget } from '../runWrites.ts'
import { CELL_DRAW } from './worldLinks.ts'
import { byteLengths } from '../../../../../math/src/sequence/byteLengths.ts'
import {
  CELL_TOLD,
  createFollowState,
  followWords,
  markAll,
  settleAll,
  tell,
  type Follow,
} from './worldFollowState.ts'

export { CELL_TOLD }

/** The words `moved` names of `words`, sent. */
function send(cold: RangeTarget, moved: Follow['movedStates'], words: RangeSource) {
  if (!moved.count) return
  const sorted = moved.take()
  writeRanges(cold, sorted, sorted.length, words)
}

/** The queries on the cells and files: what is visible, what draws, which file is shown where. */
function cellQueries(s: Follow) {
  const { cells, states, roots } = s.world
  const { instances, visible } = s
  return {
    /** Whether cell `cell` of instance `instance` was visible at the last cut. */
    visible: (instance: number, cell: number) =>
      instance < instances && cell < cells && visible[instance * cells + cell] === 1,
    /** Whether the actor of cell `cell` of instance `instance` draws as of the last cut: its word. */
    draws: (instance: number, cell: number) =>
      instance < instances &&
      cell < cells &&
      (states[instance * cells + cell] & CELL_DRAW.hlod) !== 0,
    /** Whether cell file `file` of instance `instance` was shown at the last cut, the slot of its
     *  word (-1 for none), and how many times a file took a slot or gave one back (`worldFiles.ts`). */
    fileShown: s.files.shownIn,
    fileSlot: s.files.slotIn,
    /** The packed page of world rank 0 in instance `instance`: its rank `r` is packed page
     *  `pageBase(instance) + r`. */
    pageBase: (instance: number) => s.packed.cutLinks[roots[instance]].pageBase,
    /** Each cell of instance `instance` whose visibility moved since the last call for it. */
    moved: s.moves.moved,
    /** Each page whose drawing a switch moved since the last call, told to `visit` by its placement
     *  and its rank there (`worldSwitched.ts`). */
    switched: s.switchedPages.take,
  }
}

/** What the partition and the session tell the follower: the placements (`worldPlacements.ts`),
 *  the cells' words, the warm-ups, the HLOD actors and the blocking load. */
function followerInputs(s: Follow) {
  const { cells } = s.world
  const { instances, warmth, placed } = s
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
      if (s.told[at] === word) return false
      tell(s, at, word)
      return true
    },
    /** A switch that draws an actor waits until the warm-up given says it passed, asked again at
     *  each cut while it waits; none, it waits for nothing past its loads. */
    warmWith: warmth.warmWith,
    /** The session's first image is shown (`../../../frame/loop/firstImage.ts`): the initial load
     *  ends, and a switch waits on a warm-up from now on. */
    firstImageShown: warmth.firstImageShown,
    /** The HLOD actors on or off (`hlodEnabled`): every cell's word written again. */
    hlodEnabled(on: boolean) {
      if (warmth.hlodEnabled(on)) markAll(s.marks, cells * instances)
    },
    /** The cells are activated, or loaded and not activated: every cell's and file's word is
     *  written again. */
    activated(on: boolean) {
      if (!warmth.activated(on)) return
      s.refile = true
      markAll(s.marks, cells * instances)
    },
    /** The cell files of instance `instance` a load blocking on slow streaming waits for, read as
     *  they stand at each sync, none once it blocks no more: the cells it kept hidden then switch
     *  again. */
    blockingLoad(instance: number, waits: ReadonlySet<number>) {
      if (instance >= instances) return
      s.blockOn[instance] = waits
      const on = s.blockOn.some((files) => !!files?.size)
      if (warmth.blockingLoad(on) && !on) markAll(s.marks, cells * instances)
    },
  }
}

/** The follower of the world's cells in `packed`'s cold words; none without a world DAG. A member
 *  of the run (`../runtime/runtime.ts`): `placeInCell` moves a link, `waitRow` a row without its
 *  root, `show` what a cell is told, every residency the cut receives moves the readiness
 *  (`residency`), and every cut takes the moves up first (`sync`). */
export function createLinkFollower(resources: { packed: PackedDag; cold: RangeTarget }) {
  const { packed, cold } = resources
  if (!packed.world) return undefined
  const s = createFollowState(packed, packed.world)
  const words = followWords(packed.world)
  const { instances, files, placed, marks, unshown } = s
  /** Whether the file `key` names stays hidden while a load blocks: one it does not wait for. */
  const heldBack = (key: number) => !s.blockOn[key % instances]?.has(Math.floor(key / instances))
  return {
    ...followerInputs(s),
    ...cellQueries(s),
    get slotRevision() {
      return files.slotRevision
    },
    /** Whether a switch waits on an actor's warm-up: the view keeps drawing till it is done. */
    get warming() {
      return s.warmth.warming
    },
    /** Whether every cell and every cell file wished shows its own content, as the last cut
     *  switched them — none drawn by an actor, none drawing nothing, but a cell whose content is
     *  lost (`CELL_TOLD.lost`) —, and no cell waits to be switched again: what the session's first
     *  image waits for (`../../../frame/loop/firstImage.ts`). */
    get shown() {
      return unshown.none && files.shown && marks.count === 0
    },
    /** Advanced whenever a cell's or a file's visibility moved. */
    get revision() {
      return s.revision
    },
    /** Advanced whenever a cell's draw word moved. */
    get drawRevision() {
      return s.drawRevision
    },
    /** Before every cut: the cells and files waiting switched — those whose switch waits on an
     *  actor warming asked again —, the links and words that moved go up; whether any did. */
    sync() {
      const moved = settleAll(s, heldBack)
      send(cold, placed.movedLinks, words.link)
      send(cold, s.movedStates, words.state)
      send(cold, files.moved, words.file)
      return moved
    },
    /** Bytes of its host tables. */
    get hostBytes() {
      return (
        byteLengths(s.told, s.visible, marks, unshown, s.movedStates) +
        placed.hostBytes +
        files.hostBytes +
        s.switchedPages.hostBytes
      )
    },
  }
}

export type LinkFollower = NonNullable<ReturnType<typeof createLinkFollower>>
