/**
 * THE CHAIN OF HLOD CELLS A PARTITION FOLLOWS: which cells are wished, which load, told to the
 * cut, and the roots each cell holds while its actor is loaded.
 *
 * Each HLOD grid streams its cells within its loading range: a cell above HLOD 0 is wished while
 * the view's shape for its grid's range meets the bounds it streams by (`StreamingSource.meets`),
 * or while a wished cell of a grid that asks it pulls it in (`hlodPulls.ts`) — an HLOD 0 cell as
 * the plan finds it (`../partition/plan.ts`). A cell's actor is content of the
 * cell it lies in, its parent in the chain: held while that parent loads or has loaded — from its
 * turn to load (`LoadSlots`) until it is wished no more —, or is still visible until it is made
 * invisible, a cell unloaded only once hidden; always for an actor always loaded — built by a
 * layer not spatially loaded, or held whole by no cell below its grid's top (`src/hlod/cells.rs`).
 * An actor not built holds nothing, and stands for nothing. A loaded actor's roots are held,
 * visible or not, and its rows placed — the objects standing as themselves in it (`hlodRows.ts`) —:
 * a loaded HLOD actor stays hidden while its source cell is visible, ready for the switch.
 *
 * A cell above HLOD 0 wished whose children's actors are not all held and landed waits its turn to
 * load (`waiting`), as does the unit of the actors always loaded of a level (`hlodTops.ts`): in the
 * partition's one load order, so many loading at once at most (`../partition/loadSlots.ts`). The
 * holds are asked by the priority of their unit's turn, the cell files' too (`hlodHolds.ts`).
 *
 * A frame does only what moved: each grid's cells are found around the eye in buckets of their
 * own, one bucket a grid's reach wide (`createGridBuckets`, `hlodBuckets.ts`), the cells entering
 * or leaving its range alone told again; a cell whose word, whose turn or whose parent's
 * visibility moved has its children's loads weighed again, and nothing else. Each frame the cut
 * is told what each cell that moved is (`WorldCells.show`) and switches its visibility
 * (`../dag/worlds/worldFollow.ts`).
 *
 * Cost, for C cells of the chain, G grids and n cells within a grid's range: O(C) once at
 * creation, then per eye move O(G · n), per moved cell O(its children), per frame O(cells
 * wished); nothing more while nothing moved.
 */
import type { WorldRootsHold } from './worldRoots.ts'
import type { WorldCells } from '../dag/worlds/worldCells.ts'
import { createGridBuckets } from './hlodBuckets.ts'
import { createHoldOrder } from './hlodHolds.ts'
import { createTops } from './hlodTops.ts'
import type { HlodPulls } from './hlodPulls.ts'
import type { ActorRows } from './hlodRows.ts'
import type { createCellHolds } from '../partition/cellHolds.ts'
import type { LeafWish } from '../partition/plan.ts'
import type { LoadingCell, LoadSlots } from '../partition/loadSlots.ts'
import type { StreamingSource } from '../partition/source.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { CELL_TOLD } from '../dag/worlds/worldFollow.ts'
import { cellChildren } from '../dag/worlds/worldLinks.ts'
import { CHAIN_ACTOR } from '../../../../sdk-core/src/manifest/worldRoots.ts'
import { keepNumbers } from '../../../../math/src/vector/vector.ts'

/** The chain of HLOD cells of a partition, their roots held in `holds` on `world`'s table and
 *  their actors' rows placed by `actorRows`, the partition's `grids` (`TablePartition.hlod.grids`)
 *  streamed by the view `source`, the cells taking their turn to load from `slots`. */
export function createHlodCells(
  world: Partial<Pick<WorldRootsHold, 'table'>> | undefined,
  holds: ReturnType<typeof createCellHolds>,
  grids: readonly PartitionGrid[],
  source: StreamingSource,
  slots: Pick<LoadSlots, 'loads' | 'priorityOf'>,
  pulls?: Pick<HlodPulls, 'on' | 'pulled'>,
  actorRows?: ActorRows,
) {
  const chain = world?.table?.chain
  const count = chain?.parent.length ?? 0
  /** Per cell: wished, every cell file of an HLOD 0 cell placed, one of them refused for good, its
   *  actor's roots held, its turn to load come while it stays wished, and the word it was last
   *  told (`CELL_TOLD`). */
  const wished = new Uint8Array(count),
    placed = new Uint8Array(count),
    lost = new Uint8Array(count),
    loadedNow = new Uint8Array(count),
    started = new Uint8Array(count),
    toldWords = new Uint8Array(count)
  /** Each cell's children: the cells whose actors lie in it. */
  const below = chain ? cellChildren(chain.parent) : []
  let buckets = chain && createGridBuckets(chain, grids, source)
  /** Per grid, the cells above HLOD 0 wished now and the list the next measure fills, swapped;
   *  the HLOD 0 cells wished or placed now. */
  const wishedOf = new Map<number, [number[], number[]]>(),
    leavesOn = new Set<number>()
  /** The cells whose actors are loaded. */
  const loadedCells = new Set<number>()
  /** The cells whose word may have moved, and those whose load may have. */
  const toldDue: number[] = [],
    loadDue: number[] = []
  /** Whether `cell`'s actor is held and landed, its rows placed; a failed one waits for nothing. */
  const landed = (cell: number) =>
    !!loadedNow[cell] && !holds.stillReads(cell) && !actorRows?.pending(cell)
  /** The units of the actors always loaded (`hlodTops.ts`), and the cells' ranks and holds
   *  (`hlodHolds.ts`). */
  const tops = createTops(chain, slots, landed, (cell) => void loadDue.push(cell))
  const order = chain && createHoldOrder(chain, grids, source, slots, tops, holds, actorRows)
  /** What the cells were last followed under: the eye, the cut and the instance of the world DAG,
   *  and the holds. */
  const seenEye = new Float64Array(3).fill(NaN)
  let toldTo: WorldCells | undefined,
    instance = 0,
    seenHolds = -1,
    /** The revision of the view's shape the cells were last measured under
     *  (`StreamingSource.revision`): a setting it reads moved. */
    seenShape = -1,
    /** Whether every cell was weighed since the last cut, instance or close. */
    weighed = false
  const visible = (cell: number) => !!toldTo?.visible(instance, cell)
  /** Whether `cell` has an actor built: what the table says (`CHAIN_ACTOR`), the cut's own word. */
  const hasActor = (cell: number) => (chain!.actor[cell] & CHAIN_ACTOR.built) !== 0
  /** Whether `cell`'s actor is loaded: none not built; one always loaded once its unit's turn has
   *  come (`hlodTops.ts`), else while its parent loads or has loaded — its turn come, while it
   *  stays wished — or is still visible. */
  const loaded = (cell: number) => {
    if (!hasActor(cell)) return false
    const up = chain!.parent[cell]
    return up < 0 ? tops.opened(cell) : started[up] === 1 || visible(up)
  }
  /** `cell`'s word may have moved. */
  const tell = (cell: number) => void toldDue.push(cell)
  /** The loads of `cell`'s children may have moved. */
  const weighChildren = (cell: number) => {
    for (const child of below[cell]) loadDue.push(child)
  }
  /** Whether every child of `cell` with an actor built has it held and landed, its rows placed. */
  const settled = (child: number) => !hasActor(child) || landed(child)
  const whole = (cell: number) => below[cell].every(settled)
  /** Each upper cell's wish from `eye`, the cells entering or leaving their range told again; one
   *  wished no more loses its turn, its children's loads weighed again. A reach that moved files
   *  the cells again, and measures again from an eye that stood, as a shape that turns with the
   *  view does at each frame (`StreamingSource.turns`) and as one whose settings moved does
   *  (`StreamingSource.revision`). */
  const measure = (eye: ArrayLike<number>) => {
    if (buckets!.stale()) {
      buckets = createGridBuckets(chain!, grids, source)
      seenEye.fill(NaN)
    }
    const eyeStood = keepNumbers(seenEye, eye),
      shapeStood = source.revision === seenShape
    seenShape = source.revision
    if (eyeStood && shapeStood && !source.turns()) return
    for (const grid of buckets!.grids()) {
      let lists = wishedOf.get(grid)
      if (!lists) wishedOf.set(grid, (lists = [[], []]))
      const [before, now] = lists
      now.length = 0
      meeting = now
      buckets!.near(grid, eye[0], eye[2], meet)
      // Wished too: those the wished cells of a grid that asks it pull in (`hlodPulls.ts`).
      for (const cell of pulls?.on(grid) ?? [])
        if (chain!.level[cell] && pulls!.pulled(cell)) meet(cell)
      // Wished before and not met now: leaving.
      for (const cell of before) {
        if (wished[cell] !== 1) continue
        wished[cell] = 0
        if (started[cell]) {
          started[cell] = 0
          weighChildren(cell)
        }
        tell(cell)
      }
      for (const cell of now) wished[cell] = 1
      lists[0] = now
      lists[1] = before
    }
  }
  /** The list a measure fills, and each cell met into it: kept (2) or entering (3), told again. */
  let meeting: number[] = []
  const meet = (cell: number) => {
    meeting.push(cell)
    if (wished[cell]) wished[cell] = 2
    else {
      wished[cell] = 3
      tell(cell)
    }
  }
  /** `cell`'s actor loaded or let go as it now is, one loaded held by `settle`. */
  const load = (cell: number) => {
    const now = loaded(cell)
    if (now === (loadedNow[cell] === 1)) return
    loadedNow[cell] = Number(now)
    if (now) {
      loadedCells.add(cell)
      order!.open(cell)
    } else {
      loadedCells.delete(cell)
      holds.release(cell)
      actorRows?.release(cell)
    }
    // Its hold's failure, or its end, moves its word.
    tell(cell)
  }
  /** `cell` told what it is now. */
  const told = (cell: number) => {
    let word = wished[cell] ? CELL_TOLD.wished : 0
    if (placed[cell]) word |= CELL_TOLD.placed
    if (lost[cell]) word |= CELL_TOLD.lost
    if (holds.failed(cell)) word |= CELL_TOLD.failed
    if (actorRows?.seated(cell)) word |= CELL_TOLD.rows
    if (toldWords[cell] === word) return
    toldWords[cell] = word
    toldTo?.show(instance, cell, word)
  }
  /** Every cell due, settled — what a word told moves is read by the cut at once, never left for a
   *  camera move that may not come —, the loads in the order they fell due. */
  const settle = () => {
    while (toldDue.length || loadDue.length) {
      for (let cell = toldDue.pop(); cell !== undefined; cell = toldDue.pop()) told(cell)
      for (let at = 0; at < loadDue.length; at++) load(loadDue[at])
      loadDue.length = 0
      order?.flush((cell) => loadedNow[cell] === 1)
    }
  }
  return {
    /** The frame from `eye` (in the cells' frame), with the HLOD 0 cells the plan met (`leaves`):
     *  each cell that moved told to `cells`, as instance `at` of the world DAG; each loaded
     *  actor's roots held, every other let go. */
    follow(
      leaves: ReadonlyMap<number, LeafWish>,
      eye: ArrayLike<number>,
      cells: WorldCells | undefined,
      at: number,
    ) {
      if (!chain) return
      if (!weighed || cells !== toldTo || at !== instance) {
        // Another cut or instance was told nothing yet: every cell is told and weighed anew.
        toldWords.fill(0)
        toldTo = cells
        instance = at
        weighed = true
        for (let cell = 0; cell < count; cell++) {
          tell(cell)
          loadDue.push(cell)
        }
      }
      measure(eye)
      for (const [cell, leaf] of leaves) {
        const wish = Number(leaf.wished),
          whole = Number(leaf.placed),
          gone = Number(leaf.lost)
        if (wish || whole || gone) leavesOn.add(cell)
        if (wished[cell] === wish && placed[cell] === whole && lost[cell] === gone) continue
        wished[cell] = wish
        placed[cell] = whole
        lost[cell] = gone
        tell(cell)
      }
      for (const cell of leavesOn) {
        if (leaves.has(cell)) continue
        leavesOn.delete(cell)
        wished[cell] = placed[cell] = lost[cell] = 0
        tell(cell)
      }
      // A cell whose visibility moved moves its children's loads.
      cells?.moved(at, weighChildren)
      // A hold failed or ended moves its cell's word; so do its actor's rows placed while the cut
      // follows the world, or parked, those read since placed.
      if (holds.revision !== seenHolds) for (const cell of loadedCells) tell(cell)
      actorRows?.turn(!!cells, tell)
      actorRows?.place(tell)
      settle()
      seenHolds = holds.revision
    },
    /** The cells above HLOD 0 wished whose children's actors are not all held and landed, ranked
     *  in the load order (`LoadingCell`), and the units of the actors always loaded not whole, onto
     *  `out`. */
    waiting(out: LoadingCell[]) {
      if (!chain) return
      for (const [, [now]] of wishedOf)
        for (const cell of now) if (!whole(cell)) out.push(order!.ranked(cell))
      tops.waiting(out)
    },
    /** The cells above HLOD 0 whose turn to load `slots` gives now start, their children's actors
     *  held from now on, while they stay wished; so do the units of the actors always loaded. */
    start() {
      if (!chain) return
      for (const [, [now]] of wishedOf)
        for (const cell of now) {
          if (started[cell] || !slots.loads(cell)) continue
          started[cell] = 1
          weighChildren(cell)
        }
      tops.start()
      settle()
    },
    /** Whether HLOD cell `cell` was visible at the cut's last image. */
    visible,
    /** Every cell let go: its roots, its actor's rows, and what it was told. */
    close(cells: WorldCells | undefined, at: number) {
      for (const cell of holds.cells()) holds.release(cell)
      for (const cell of loadedCells) actorRows?.release(cell)
      for (let cell = 0; cell < count; cell++) if (toldWords[cell]) cells?.show(at, cell, 0)
      for (const state of [wished, placed, lost, loadedNow, started, toldWords]) state.fill(0)
      loadedCells.clear()
      leavesOn.clear()
      wishedOf.clear()
      toldDue.length = loadDue.length = 0
      order?.clear()
      tops.clear()
      seenEye.fill(NaN)
      toldTo = undefined
      weighed = false
    },
  }
}
