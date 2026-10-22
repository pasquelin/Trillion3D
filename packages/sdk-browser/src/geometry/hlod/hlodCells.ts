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
 * A cell above HLOD 0 wished whose children's actors are not all held and read waits its turn to
 * load (`waiting`), as does the unit of the actors always loaded of a level (`hlodTops.ts`): in the
 * partition's one load order (`../partition/loadOrder.ts`), so many loading at once at most
 * (`../partition/loadSlots.ts`). The
 * slot is held while the reads are not done, no longer: an actor whose rows wait for room in the
 * pool is loaded, and stays undrawn (`CELL_TOLD.rows`). The holds are asked by the priority of
 * their unit's turn, the cell files' too (`hlodHolds.ts`).
 *
 * A frame does only what moved: the cells wished are found around the eye (`hlodWishes.ts`), the
 * cells entering or leaving a grid's range alone told again; a cell whose word, whose turn or
 * whose parent's visibility moved has its children's loads weighed again, and nothing else. Each
 * frame the cut is told what each cell that moved is (`WorldCells.show`) and switches its
 * visibility (`../dag/worlds/worldFollow.ts`).
 *
 * Cost, for C cells of the chain, G grids and n cells within a grid's range: O(C) once at
 * creation, then per eye move O(G · n), per moved cell O(its children), per hold landed O(1), per
 * frame O(cells wished) reading the flags the moves kept; nothing more while nothing moved.
 */
import type { WorldRootsHold } from './worldRoots.ts'
import type { WorldCells } from '../dag/worlds/worldCells.ts'
import { createHoldOrder } from './hlodHolds.ts'
import { createTops } from './hlodTops.ts'
import { createWishes } from './hlodWishes.ts'
import type { HlodPulls } from './hlodPulls.ts'
import type { ActorRows } from './hlodRows.ts'
import type { createCellHolds } from '../partition/cellHolds.ts'
import type { LeafWish, Ranker } from '../partition/plan.ts'
import type { LoadingCell } from '../partition/loadOrder.ts'
import type { LoadSlots } from '../partition/loadSlots.ts'
import type { StreamingSource } from '../partition/source.ts'
import { cellUnit } from '../partition/unitKeys.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { CELL_TOLD } from '../dag/worlds/worldFollow.ts'
import { cellChildren } from '../dag/worlds/worldLinks.ts'
import { CHAIN_ACTOR } from '../../../../sdk-core/src/manifest/worldRoots.ts'

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
   *  actor's roots held, its turn to load come while it stays wished, its actor's reads done, and
   *  the word it was last told (`CELL_TOLD`). */
  const wished = new Uint8Array(count),
    placed = new Uint8Array(count),
    lost = new Uint8Array(count),
    loadedNow = new Uint8Array(count),
    started = new Uint8Array(count),
    landedNow = new Uint8Array(count),
    toldWords = new Uint8Array(count)
  /** Each cell's children: the cells whose actors lie in it. */
  const below = chain ? cellChildren(chain.parent) : []
  /** Whether `cell` has an actor built: what the table says (`CHAIN_ACTOR`), the cut's own word. */
  const hasActor = (cell: number) => (chain!.actor[cell] & CHAIN_ACTOR.built) !== 0
  /** Per cell, how many of its children with an actor built are not landed: none, it is whole. */
  const unlanded = new Uint32Array(count)
  const countUnlanded = () => {
    unlanded.fill(0)
    for (let cell = 0; cell < count; cell++)
      if (chain!.parent[cell] >= 0 && hasActor(cell)) unlanded[chain!.parent[cell]]++
  }
  countUnlanded()
  /** The HLOD 0 cells wished or placed now. */
  const leavesOn = new Set<number>()
  /** The cells whose actors are loaded. */
  const loadedCells = new Set<number>()
  /** The cells whose word may have moved, those whose load may have, and those whose landing may
   *  have. */
  const toldDue: number[] = [],
    loadDue: number[] = [],
    landDue: number[] = []
  /** The units of the actors always loaded (`hlodTops.ts`), and the cells' ranks and holds
   *  (`hlodHolds.ts`). */
  const tops = createTops(chain, slots, (cell) => void loadDue.push(cell))
  const order = chain && createHoldOrder(chain, grids, slots, tops, holds, actorRows)
  /** What the cells were last followed under: the cut and the instance of the world DAG, and the
   *  holds. */
  let toldTo: WorldCells | undefined,
    instance = 0,
    seenHolds = -1,
    /** Whether every cell was weighed since the last cut, instance or close. */
    weighed = false
  const visible = (cell: number) => !!toldTo?.visible(instance, cell)
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
  /** The cells above HLOD 0 the view wishes (`hlodWishes.ts`). */
  const wishes =
    chain && createWishes(chain, grids, source, pulls, { wished, started, tell, weighChildren })
  /** `cell`'s actor held and its reads done, or no longer: its parent's count, or its unit's, told.
   *  A failed read waits for nothing; rows waiting for room in the pool wait for nothing either. */
  const lands = (cell: number) => {
    const now = loadedNow[cell] === 1 && !holds.stillReads(cell)
    if (now === (landedNow[cell] === 1)) return
    landedNow[cell] = Number(now)
    const up = chain!.parent[cell]
    if (up < 0) tops.landing(cell, now)
    else unlanded[up] += now ? -1 : 1
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
    landDue.push(cell)
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
   *  camera move that may not come —, the loads in the order they fell due, a cell loaded held
   *  before its landing is weighed. */
  const settle = () => {
    while (toldDue.length || loadDue.length) {
      for (let cell = toldDue.pop(); cell !== undefined; cell = toldDue.pop()) told(cell)
      for (let at = 0; at < loadDue.length; at++) load(loadDue[at])
      loadDue.length = 0
      order?.flush((cell) => loadedNow[cell] === 1)
      for (const cell of landDue) lands(cell)
      landDue.length = 0
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
      wishes!.measure(eye)
      for (const [cell, leaf] of leaves) {
        const wish = Number(leaf.wished),
          placedNow = Number(leaf.placed),
          gone = Number(leaf.lost)
        if (wish || placedNow || gone) leavesOn.add(cell)
        if (wished[cell] === wish && placed[cell] === placedNow && lost[cell] === gone) continue
        wished[cell] = wish
        placed[cell] = placedNow
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
      // A hold landed or failed ends its cell's reads.
      holds.arrived(lands)
      // A hold failed or ended moves its cell's word; so do its actor's rows placed while the cut
      // follows the world, or parked, those read since placed.
      if (holds.revision !== seenHolds) for (const cell of loadedCells) tell(cell)
      actorRows?.turn(!!cells, tell)
      actorRows?.place(tell)
      settle()
      seenHolds = holds.revision
    },
    /** The cells above HLOD 0 wished whose children's actors are not all held and read, ranked on
     *  `ranker`'s records in the load order (`LoadingCell`), and the units of the actors always
     *  loaded not whole, onto `out`. */
    waiting(out: LoadingCell[], ranker: Ranker) {
      if (!chain) return
      for (const [, [now]] of wishes!.lists)
        for (const cell of now) if (unlanded[cell] > 0) out.push(order!.ranked(cell, ranker))
      tops.waiting(out)
    },
    /** The cells above HLOD 0 whose turn to load `slots` gives now start, their children's actors
     *  held from now on, while they stay wished; so do the units of the actors always loaded. */
    start() {
      if (!chain) return
      for (const [, [now]] of wishes!.lists)
        for (const cell of now) {
          if (started[cell] || !slots.loads(cellUnit(cell))) continue
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
      for (const state of [wished, placed, lost, loadedNow, started, landedNow, toldWords])
        state.fill(0)
      countUnlanded()
      loadedCells.clear()
      leavesOn.clear()
      wishes?.clear()
      toldDue.length = loadDue.length = landDue.length = 0
      order?.clear()
      tops.clear()
      toldTo = undefined
      weighed = false
    },
  }
}
