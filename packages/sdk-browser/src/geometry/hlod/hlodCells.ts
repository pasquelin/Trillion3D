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

/** What `createHlodCells` follows: the per-cell flags and the work queues its steps share. */
interface ChainState {
  chain: NonNullable<WorldRootsHold['table']>['chain'] | undefined
  count: number
  holds: ReturnType<typeof createCellHolds>
  actorRows: ActorRows | undefined
  tops: ReturnType<typeof createTops>
  order: ReturnType<typeof createHoldOrder> | undefined
  slots: Pick<LoadSlots, 'loads' | 'priorityOf'>
  /** The cells above HLOD 0 the view wishes (`hlodWishes.ts`). */
  wishes: ReturnType<typeof createWishes> | undefined
  /** Per cell: wished, every cell file of an HLOD 0 cell placed, one of them refused for good, its
   *  actor's roots held, its turn to load come while it stays wished, its actor's reads done, and
   *  the word it was last told (`CELL_TOLD`). */
  wished: Uint8Array
  placed: Uint8Array
  lost: Uint8Array
  loadedNow: Uint8Array
  started: Uint8Array
  landedNow: Uint8Array
  toldWords: Uint8Array
  /** Each cell's children: the cells whose actors lie in it. */
  below: readonly (readonly number[])[]
  /** Per cell, how many of its children with an actor built are not landed: none, it is whole. */
  unlanded: Uint32Array
  /** The HLOD 0 cells wished or placed now. */
  leavesOn: Set<number>
  /** The cells whose actors are loaded. */
  loadedCells: Set<number>
  /** The cells whose word may have moved, those whose load may have, and those whose landing may
   *  have. */
  toldDue: number[]
  loadDue: number[]
  landDue: number[]
  /** What the cells were last followed under: the cut and the instance of the world DAG, and the
   *  holds. */
  toldTo: WorldCells | undefined
  instance: number
  seenHolds: number
  /** Whether every cell was weighed since the last cut, instance or close. */
  weighed: boolean
  /** `tell`, `weighChildren` and `lands` as callbacks of the cell, made once. */
  tell: (cell: number) => void
  weigh: (cell: number) => void
  land: (cell: number) => void
}

/** Whether `cell` has an actor built: what the table says (`CHAIN_ACTOR`), the cut's own word. */
const hasActor = (s: ChainState, cell: number) => (s.chain!.actor[cell] & CHAIN_ACTOR.built) !== 0

const countUnlanded = (s: ChainState) => {
  s.unlanded.fill(0)
  for (let cell = 0; cell < s.count; cell++)
    if (s.chain!.parent[cell] >= 0 && hasActor(s, cell)) s.unlanded[s.chain!.parent[cell]]++
}

const visibleCell = (s: ChainState, cell: number) => !!s.toldTo?.visible(s.instance, cell)

/** Whether `cell`'s actor is loaded: none not built; one always loaded once its unit's turn has
 *  come (`hlodTops.ts`), else while its parent loads or has loaded — its turn come, while it
 *  stays wished — or is still visible. */
const isLoaded = (s: ChainState, cell: number) => {
  if (!hasActor(s, cell)) return false
  const up = s.chain!.parent[cell]
  return up < 0 ? s.tops.opened(cell) : s.started[up] === 1 || visibleCell(s, up)
}

/** `cell`'s word may have moved. */
const tell = (s: ChainState, cell: number) => void s.toldDue.push(cell)

/** The loads of `cell`'s children may have moved. */
const weighChildren = (s: ChainState, cell: number) => {
  for (const child of s.below[cell]) s.loadDue.push(child)
}

/** `cell`'s actor held and its reads done, or no longer: its parent's count, or its unit's, told.
 *  A failed read waits for nothing; rows waiting for room in the pool wait for nothing either. */
const lands = (s: ChainState, cell: number) => {
  const now = s.loadedNow[cell] === 1 && !s.holds.stillReads(cell)
  if (now === (s.landedNow[cell] === 1)) return
  s.landedNow[cell] = Number(now)
  const up = s.chain!.parent[cell]
  if (up < 0) s.tops.landing(cell, now)
  else s.unlanded[up] += now ? -1 : 1
}

/** `cell`'s actor loaded or let go as it now is, one loaded held by `settle`. */
const load = (s: ChainState, cell: number) => {
  const now = isLoaded(s, cell)
  if (now === (s.loadedNow[cell] === 1)) return
  s.loadedNow[cell] = Number(now)
  if (now) {
    s.loadedCells.add(cell)
    s.order!.open(cell)
  } else {
    s.loadedCells.delete(cell)
    s.holds.release(cell)
    s.actorRows?.release(cell)
  }
  s.landDue.push(cell)
  // Its hold's failure, or its end, moves its word.
  tell(s, cell)
}

/** `cell` told what it is now. */
const told = (s: ChainState, cell: number) => {
  let word = s.wished[cell] ? CELL_TOLD.wished : 0
  if (s.placed[cell]) word |= CELL_TOLD.placed
  if (s.lost[cell]) word |= CELL_TOLD.lost
  if (s.holds.failed(cell)) word |= CELL_TOLD.failed
  if (s.actorRows?.seated(cell)) word |= CELL_TOLD.rows
  if (s.toldWords[cell] === word) return
  s.toldWords[cell] = word
  s.toldTo?.show(s.instance, cell, word)
}

/** Every cell due, settled — what a word told moves is read by the cut at once, never left for a
 *  camera move that may not come —, the loads in the order they fell due, a cell loaded held
 *  before its landing is weighed. */
const settle = (s: ChainState) => {
  while (s.toldDue.length || s.loadDue.length) {
    for (let cell = s.toldDue.pop(); cell !== undefined; cell = s.toldDue.pop()) told(s, cell)
    for (let at = 0; at < s.loadDue.length; at++) load(s, s.loadDue[at])
    s.loadDue.length = 0
    s.order?.flush((cell) => s.loadedNow[cell] === 1)
    for (const cell of s.landDue) lands(s, cell)
    s.landDue.length = 0
  }
}

/** Another cut or instance was told nothing yet: every cell is told and weighed anew. */
const retell = (s: ChainState, cells: WorldCells | undefined, at: number) => {
  s.toldWords.fill(0)
  s.toldTo = cells
  s.instance = at
  s.weighed = true
  for (let cell = 0; cell < s.count; cell++) {
    tell(s, cell)
    s.loadDue.push(cell)
  }
}

/** The HLOD 0 cells the plan met, their words read and the cells that changed told. */
const readLeaves = (s: ChainState, leaves: ReadonlyMap<number, LeafWish>) => {
  const { wished, placed, lost, leavesOn } = s
  for (const [cell, leaf] of leaves) {
    const wish = Number(leaf.wished),
      placedNow = Number(leaf.placed),
      gone = Number(leaf.lost)
    if (wish || placedNow || gone) leavesOn.add(cell)
    if (wished[cell] === wish && placed[cell] === placedNow && lost[cell] === gone) continue
    wished[cell] = wish
    placed[cell] = placedNow
    lost[cell] = gone
    tell(s, cell)
  }
  for (const cell of leavesOn) {
    if (leaves.has(cell)) continue
    leavesOn.delete(cell)
    wished[cell] = placed[cell] = lost[cell] = 0
    tell(s, cell)
  }
}

/** The frame: see `createHlodCells.follow`. */
const followFrame = (
  s: ChainState,
  leaves: ReadonlyMap<number, LeafWish>,
  eye: ArrayLike<number>,
  cells: WorldCells | undefined,
  at: number,
) => {
  const { chain, holds, actorRows } = s
  if (!chain) return
  if (!s.weighed || cells !== s.toldTo || at !== s.instance) retell(s, cells, at)
  s.wishes!.measure(eye)
  readLeaves(s, leaves)
  // A cell whose visibility moved moves its children's loads.
  cells?.moved(at, s.weigh)
  // A hold landed or failed ends its cell's reads.
  holds.arrived(s.land)
  // A hold failed or ended moves its cell's word; so do its actor's rows placed while the cut
  // follows the world, or parked, those read since placed.
  if (holds.revision !== s.seenHolds) for (const cell of s.loadedCells) tell(s, cell)
  actorRows?.turn(!!cells, s.tell)
  actorRows?.place(s.tell)
  settle(s)
  s.seenHolds = holds.revision
}

/** The cells above HLOD 0 wished whose children's actors are not all held and read, ranked on
 *  `ranker`'s records, and the units of the actors always loaded not whole, onto `out`. */
const waitingCells = (s: ChainState, out: LoadingCell[], ranker: Ranker) => {
  if (!s.chain) return
  for (const [, [now]] of s.wishes!.lists)
    for (const cell of now) if (s.unlanded[cell] > 0) out.push(s.order!.ranked(cell, ranker))
  s.tops.waiting(out)
}

/** The cells above HLOD 0 whose turn to load `slots` gives now start. */
const startCells = (s: ChainState) => {
  if (!s.chain) return
  for (const [, [now]] of s.wishes!.lists)
    for (const cell of now) {
      if (s.started[cell] || !s.slots.loads(cellUnit(cell))) continue
      s.started[cell] = 1
      weighChildren(s, cell)
    }
  s.tops.start()
  settle(s)
}

/** Every cell let go: its roots, its actor's rows, and what it was told. */
const closeAll = (s: ChainState, cells: WorldCells | undefined, at: number) => {
  const { holds, actorRows } = s
  for (const cell of holds.cells()) holds.release(cell)
  for (const cell of s.loadedCells) actorRows?.release(cell)
  for (let cell = 0; cell < s.count; cell++) if (s.toldWords[cell]) cells?.show(at, cell, 0)
  for (const state of [
    s.wished,
    s.placed,
    s.lost,
    s.loadedNow,
    s.started,
    s.landedNow,
    s.toldWords,
  ])
    state.fill(0)
  countUnlanded(s)
  s.loadedCells.clear()
  s.leavesOn.clear()
  s.wishes?.clear()
  s.toldDue.length = s.loadDue.length = s.landDue.length = 0
  s.order?.clear()
  s.tops.clear()
  s.toldTo = undefined
  s.weighed = false
}

/** The state of the chain of `world`'s table: every flag clear, every queue empty. */
function createChainState(
  world: Partial<Pick<WorldRootsHold, 'table'>> | undefined,
  holds: ReturnType<typeof createCellHolds>,
  grids: readonly PartitionGrid[],
  slots: Pick<LoadSlots, 'loads' | 'priorityOf'>,
  actorRows?: ActorRows,
) {
  const chain = world?.table?.chain
  const count = chain?.parent.length ?? 0
  const loadDue: number[] = []
  /** The units of the actors always loaded (`hlodTops.ts`), and the cells' ranks and holds
   *  (`hlodHolds.ts`). */
  const tops = createTops(chain, slots, (cell) => void loadDue.push(cell))
  const s: ChainState = {
    chain,
    count,
    holds,
    actorRows,
    tops,
    order: chain && createHoldOrder(chain, grids, slots, tops, holds, actorRows),
    slots,
    wishes: undefined,
    wished: new Uint8Array(count),
    placed: new Uint8Array(count),
    lost: new Uint8Array(count),
    loadedNow: new Uint8Array(count),
    started: new Uint8Array(count),
    landedNow: new Uint8Array(count),
    toldWords: new Uint8Array(count),
    below: chain ? cellChildren(chain.parent) : [],
    unlanded: new Uint32Array(count),
    leavesOn: new Set<number>(),
    loadedCells: new Set<number>(),
    toldDue: [],
    loadDue,
    landDue: [],
    toldTo: undefined,
    instance: 0,
    seenHolds: -1,
    weighed: false,
    tell: (cell) => tell(s, cell),
    weigh: (cell) => weighChildren(s, cell),
    land: (cell) => lands(s, cell),
  }
  countUnlanded(s)
  return s
}

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
  const s = createChainState(world, holds, grids, slots, actorRows)
  const { chain } = s
  s.wishes =
    chain &&
    createWishes(chain, grids, source, pulls, {
      wished: s.wished,
      started: s.started,
      tell: s.tell,
      weighChildren: s.weigh,
    })
  return {
    /** The frame from `eye` (in the cells' frame), with the HLOD 0 cells the plan met (`leaves`):
     *  each cell that moved told to `cells`, as instance `at` of the world DAG; each loaded
     *  actor's roots held, every other let go. */
    follow: (
      leaves: ReadonlyMap<number, LeafWish>,
      eye: ArrayLike<number>,
      cells: WorldCells | undefined,
      at: number,
    ) => followFrame(s, leaves, eye, cells, at),
    /** The cells above HLOD 0 wished whose children's actors are not all held and read, ranked on
     *  `ranker`'s records in the load order (`LoadingCell`), and the units of the actors always
     *  loaded not whole, onto `out`. */
    waiting: (out: LoadingCell[], ranker: Ranker) => waitingCells(s, out, ranker),
    /** The cells above HLOD 0 whose turn to load `slots` gives now start, their children's actors
     *  held from now on, while they stay wished; so do the units of the actors always loaded. */
    start: () => startCells(s),
    /** Whether HLOD cell `cell` was visible at the cut's last image. */
    visible: (cell: number) => visibleCell(s, cell),
    /** Every cell let go: its roots, its actor's rows, and what it was told. */
    close: (cells: WorldCells | undefined, at: number) => closeAll(s, cells, at),
  }
}
