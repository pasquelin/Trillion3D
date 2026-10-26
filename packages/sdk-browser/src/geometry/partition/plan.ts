/**
 * WHICH CELLS OF A PARTITIONED SCENE ARE WISHED, AND WHICH WAIT TO LOAD: the partition's
 * streaming policy over its cell files, one loading range per grid around the camera.
 *
 * Each grid streams its cells within its loading range of the camera, as the compiled root names
 * them (`TablePartition.hlod.grids`, `compiler/tables/partition/grid.rs`): a cell is wished while
 * the view's shape for that range meets the bounds it streams by — the box around its content, or
 * its square, as the partition's scheme says (`StreamingSource.meets`) —, tested in 2D, its up
 * axis dropped (glTF's up is `+Y`), unless its grid does not lie flat or the session culls the
 * square cells by height; and the coarser cells a wished one pulls in on a grid that asks it
 * (`coarser.ts`). A wished cell waits its turn by the level of its cell on its grid, which the
 * cook writes (`createRanker`). A cell file of objects in a layer belongs to its HLOD 0 cell — its
 * objects are that cell's HLOD 0 actor, the same meshes instanced, and the source meshes of their
 * main grid cell —: it is placed while that HLOD 0 cell loads, wished within its grid's range,
 * which holds its main grid's. A cell file of objects in no layer streams on its main grid alone,
 * the one its record names (`TableCell.main`).
 * A unit wished and not loaded — an HLOD 0 cell some file of which is not placed, or a file of no
 * layer not placed — waits its turn to load (`waiting`, `LoadSlots`); one whose file is refused
 * for good waits for nothing, said lost (`LeafWish.lost`). An HLOD 0 cell is placed whole once
 * every cell of it is placed and no page of the index that could list one of its cells waits to be
 * opened — one refused for good waits for nothing. What draws each HLOD cell is its visibility
 * (`../hlod/hlodCells.ts`, `../dag/worlds/worldFollow.ts`). The camera's far plane plays no part.
 *
 * A placed file of an HLOD 0 cell leaves once that cell is neither wished nor visible — a cell is
 * unloaded only once it is made invisible —, a file of no layer once its cell is wished no more.
 * The pages of the cell index are walked within the farthest a placed cell lies (`placedReach`)
 * and closed past its keep sphere (`reach.ts`, `cellIndex.ts`).
 */
import { boxesOverlap } from '../../../../math/src/geometry/box.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { CellIndex, IndexPage } from './cellIndex.ts'
import { coarserKey, createMainPulls, type CoarserPull } from './coarser.ts'
import { keepRadius, placedReach } from './reach.ts'
import type { LoadingCell } from './loadOrder.ts'
import type { LoadSlots } from './loadSlots.ts'
import type { StreamingSource } from './source.ts'
import { cellUnit, fileOfUnit, fileUnit, isFileUnit } from './unitKeys.ts'

/** What a world DAG says of an HLOD 0 cell: whether it keeps it visible (`../hlod/hlodCells.ts`). */
type LeafHolds = { visible(leaf: number): boolean }

/** An HLOD 0 cell met this frame: whether it is wished, whether it is placed whole, and whether a
 *  cell file of it is refused for good — it is then never placed whole. */
export type LeafWish = {
  readonly wished: boolean
  readonly placed: boolean
  readonly lost: boolean
}
/** An HLOD 0 cell met: its cells met, the bounds it streams by, its grid, the level of its cell
 *  there, and the frame it was last met. */
type Leaf = {
  wished: boolean
  placed: boolean
  lost: boolean
  cells: number[]
  bounds: ArrayLike<number>
  grid: number
  rung: number
  frame: number
}

/** An HLOD 0 cell not yet met by any frame, on `grid` at `rung`. */
const unmetLeaf = (grid: number, rung: number): Leaf => ({
  wished: false,
  placed: false,
  lost: false,
  cells: [],
  bounds: [],
  grid,
  rung,
  frame: -1,
})

/** The ranker of the cells waiting under the view `source`, its records kept from frame to frame:
 *  `restart` frees them at a frame's start, `ranked` takes one for the cell of `grid` at `level`
 *  there, streaming by the bounds `bounds` at `at`, and fills it with what ranks it in the load
 *  order (`LoadingCell`) as `source` sees it: the half side of its bounds, its level, its grid's
 *  priority, its distances. */
function createRanker(source: StreamingSource) {
  const records: LoadingCell[] = []
  let used = 0
  return {
    restart: () => void (used = 0),
    ranked(key: number, bounds: ArrayLike<number>, at: number, grid: PartitionGrid, level: number) {
      let cell = records[used]
      if (!cell) records[used] = cell = { key, extent: 0, level, priority: 0, distance: 0, raw: 0 }
      used++
      cell.key = key
      cell.extent = (bounds[at + 3] - bounds[at]) / 2
      cell.level = level
      cell.priority = grid.priority
      return source.ranked(bounds, at, grid.range, cell)
    },
  }
}

export type Ranker = ReturnType<typeof createRanker>

/** What a plan keeps from frame to frame. */
interface Plan {
  index: Pick<CellIndex, 'near' | 'cell'>
  source: StreamingSource
  pulls: readonly (CoarserPull | null)[]
  chain: { pulled(cell: number): boolean } | undefined
  leaves: Map<number, Leaf>
  pageDistances: Map<IndexPage, number>
  /** On the main grids that pull: the cells met this frame at each key, and the squares they
   *  stream by. */
  mainPulls: ReturnType<typeof createMainPulls>
  squares: Map<number, ArrayLike<number>>
  ranker: Ranker
  out: {
    leave: number[]
    pages: IndexPage[]
    leaves: Map<number, Leaf>
    alone: Map<number, ArrayLike<number>>
    main: Map<number, ArrayLike<number>>
    waiting: LoadingCell[]
    ranker: Ranker
    /** The HLOD 0 cells whose visibility alone keeps a placed file (`leaving`). */
    holds: number[]
  }
  toRead: number[]
  readAt: Map<number, number>
  /** The frames planned, the grids, and whether the files of a layer stream with their HLOD 0
   *  cell — the HLOD actors on (`layers`). */
  frame: number
  grids: readonly PartitionGrid[]
  layered: boolean
  /** Whether a page of the index the frame waits on could list a cell of a leaf: its box holds
   *  the streaming bounds of every cell it lists (`partition.rs`). */
  refused: ((url: string) => boolean) | undefined
  /** The steps of the walk as callbacks of the plan, made once. */
  steps: {
    visit: (cell: number, square: ArrayLike<number>, box: ArrayLike<number> | null) => void
    unread: (page: IndexPage, distance: number) => void
    pull: (main: number, cell: number) => void
    nearest: (a: IndexPage, b: IndexPage) => number
  }
}

const nearestPage = (p: Plan, a: IndexPage, b: IndexPage) =>
  p.pageDistances.get(a)! - p.pageDistances.get(b)!

const visit = (
  p: Plan,
  cell: number,
  square: ArrayLike<number>,
  leafBox: ArrayLike<number> | null,
) => {
  const { out, leaves } = p
  const record = p.index.cell(cell),
    { main } = record
  const wished = p.source.meets(square, 0, p.grids[main])
  if (wished) out.main.set(cell, square)
  if (p.pulls[main]) {
    p.mainPulls.meet(main, coarserKey(record.grid[0], record.grid[1], record.grid[2]), cell, wished)
    p.squares.set(cell, square)
  }
  const hlod = record.hlod
  if (!hlod || !leafBox || !p.layered) {
    if (wished) out.alone.set(cell, square)
    return
  }
  const [h, , grid, rung] = hlod
  let met = leaves.get(h)
  if (!met) leaves.set(h, (met = unmetLeaf(grid, rung)))
  if (met.frame !== p.frame) {
    met.frame = p.frame
    met.cells.length = 0
    met.grid = grid
    met.rung = rung
    met.bounds = leafBox
    met.wished = p.source.meets(leafBox, 0, p.grids[grid]) || !!p.chain?.pulled(h)
  }
  met.cells.push(cell)
}

/** `cell`, met at coordinates a wished cell of main grid `main` pulls in, wished: its main grid
 *  cell, and its file of no layer or its HLOD 0 cell on that main grid. */
const pulledIn = (p: Plan, main: number, cell: number) => {
  p.out.main.set(cell, p.squares.get(cell)!)
  const leaf = p.index.cell(cell).hlod
  if (!leaf || !p.layered) p.out.alone.set(cell, p.squares.get(cell)!)
  else if (leaf[2] === main) p.leaves.get(leaf[0])!.wished = true
}

const awaited = (p: Plan, leaf: Leaf) => {
  for (const page of p.out.pages)
    if (!p.refused?.(page.slot.url) && boxesOverlap(page.box, 0, leaf.bounds, 0)) return true
  return false
}

/** Each HLOD 0 cell met: placed whole or lost, and waiting its turn when wished. */
const settleLeaves = (
  p: Plan,
  placed: ReadonlyMap<number, unknown>,
  failed?: (url: string) => boolean,
) => {
  const { leaves, out, index, ranker, grids } = p
  for (const [h, leaf] of leaves) {
    if (leaf.frame !== p.frame) {
      leaves.delete(h)
      continue
    }
    let whole = true,
      lost = false
    for (const cell of leaf.cells) {
      if (placed.has(cell)) continue
      whole = false
      lost ||= !!failed?.(index.cell(cell).url)
    }
    leaf.placed = whole && !awaited(p, leaf)
    leaf.lost = lost
    // A cell some file of which is refused for good waits for nothing.
    if (leaf.wished && !whole && !lost)
      out.waiting.push(ranker.ranked(cellUnit(h), leaf.bounds, 0, grids[leaf.grid], leaf.rung))
  }
}

/** A placed file leaves once its HLOD 0 cell is neither wished nor visible, a file of no
 *  layer once its cell is wished no more; one kept by its cell's visibility alone is listed. */
const leaving = (p: Plan, placed: ReadonlyMap<number, unknown>, world?: LeafHolds) => {
  const { out, leaves } = p
  for (const cell of placed.keys()) {
    const hlod = p.layered && p.index.cell(cell).hlod
    if (hlod ? leaves.get(hlod[0])?.wished : out.alone.has(cell)) continue
    if (hlod && world?.visible(hlod[0])) out.holds.push(hlod[0])
    else out.leave.push(cell)
  }
}

/** The frame from `eye`: the lists emptied, the index walked, and the lists filled. */
const planFrame = (
  p: Plan,
  eye: ArrayLike<number>,
  partitionGrids: readonly PartitionGrid[],
  placed: ReadonlyMap<number, unknown>,
  failed: ((url: string) => boolean) | undefined,
  world: LeafHolds | undefined,
  layers: boolean,
) => {
  const { out, ranker } = p
  p.frame++
  p.refused = failed
  p.grids = partitionGrids
  p.layered = layers
  out.leave.length = out.pages.length = out.waiting.length = out.holds.length = 0
  ranker.restart()
  out.alone.clear()
  out.main.clear()
  p.pageDistances.clear()
  p.mainPulls.restart()
  p.squares.clear()
  const reach = placedReach(partitionGrids, p.source, p.pulls)
  p.index.near(eye, reach, keepRadius(reach), placed, p.steps.visit, p.steps.unread)
  p.mainPulls.pull(p.steps.pull)
  settleLeaves(p, placed, failed)
  for (const [cell, square] of out.alone) {
    const { url, grid, main } = p.index.cell(cell)
    if (!placed.has(cell) && !failed?.(url))
      out.waiting.push(ranker.ranked(fileUnit(cell), square, 0, partitionGrids[main], grid[0]))
  }
  out.pages.sort(p.steps.nearest)
  leaving(p, placed, world)
  return out
}

/** The cell files to read and place now: those of each unit `slots` loads, not `placed`. */
const filesToRead = (
  p: Plan,
  slots: Pick<LoadSlots, 'loading' | 'priorityOf'>,
  placed: ReadonlyMap<number, unknown>,
) => {
  const { toRead, readAt, out } = p
  toRead.length = 0
  readAt.clear()
  for (const key of slots.loading()) {
    const priority = slots.priorityOf(key)
    if (isFileUnit(key)) {
      const cell = fileOfUnit(key)
      if (out.alone.has(cell) && !placed.has(cell)) {
        toRead.push(cell)
        readAt.set(cell, priority)
      }
      continue
    }
    const leaf = p.leaves.get(key)
    if (leaf?.frame !== p.frame) continue
    for (const cell of leaf.cells) {
      if (placed.has(cell)) continue
      toRead.push(cell)
      readAt.set(cell, priority)
    }
  }
  return toRead
}

/** The state of a plan: nothing met, the callbacks of the walk made once. */
function createPlanState(
  index: Pick<CellIndex, 'near' | 'cell'>,
  source: StreamingSource,
  pulls: readonly (CoarserPull | null)[],
  chain?: { pulled(cell: number): boolean },
) {
  const leaves = new Map<number, Leaf>()
  const ranker = createRanker(source)
  const p: Plan = {
    index,
    source,
    pulls,
    chain,
    leaves,
    pageDistances: new Map<IndexPage, number>(),
    mainPulls: createMainPulls(pulls),
    squares: new Map<number, ArrayLike<number>>(),
    ranker,
    out: {
      leave: [] as number[],
      pages: [] as IndexPage[],
      leaves,
      alone: new Map<number, ArrayLike<number>>(),
      main: new Map<number, ArrayLike<number>>(),
      waiting: [] as LoadingCell[],
      ranker,
      holds: [] as number[],
    },
    toRead: [],
    readAt: new Map<number, number>(),
    frame: 0,
    grids: [],
    layered: true,
    refused: undefined,
    steps: {
      visit: (cell, square, box) => visit(p, cell, square, box),
      unread: (page, distance) => {
        p.out.pages.push(page)
        p.pageDistances.set(page, distance)
      },
      pull: (main, cell) => pulledIn(p, main, cell),
      nearest: (a, b) => nearestPage(p, a, b),
    },
  }
  return p
}

/**
 * The plan of the frames of `index` as the view `source` streams it, its lists kept from frame to
 * frame. A frame (`plan`) from `eye`, over the partition's `grids`, the cells `placed` holds,
 * whether the read of a file — a page of the index, a cell file — is refused for good (`failed`, by
 * its address) and what a world DAG says of each HLOD 0 cell (`LeafHolds`, none without one) gives
 * the placed cells that leave (`leave`), the index pages to open within the walk, nearest first
 * (`pages`), each HLOD 0 cell met (`leaves`), the cell files of no layer whose cell is wished, with
 * the square it streams by (`alone`), the cells whose main grid cell is wished with the square they
 * stream by — their rows draw the source meshes, the others their HLOD 0 actor (`main`) —, and the
 * units wished and not loaded (`waiting`, each on a record of `ranker`, freed at the next frame),
 * and the HLOD 0 cells that keep placed files only while visible (`holds`).
 * The HLOD actors off (`layers` false), every cell file streams on the main grid alone. Once the
 * load slots took the frame's units, `files` gives the cell files to read and place: those of each
 * unit loading, not placed, in the order the units started, each asked by its unit's priority
 * (`priority`) — the queue serves the reads of every cell, files and HLOD actors, in the order the
 * units took their turn.
 *
 * On a main grid whose wished cells pull in the coarser ones overlapping them (`pulls`,
 * `coarser.ts`), each cell met at the coordinates a wished one pulls is wished too, its HLOD 0
 * cell on that grid with it; an HLOD 0 cell on an HLOD grid is wished while the chain's cells pull
 * it in (`chain`, `../hlod/hlodPulls.ts`).
 */
export function createCellPlan(
  index: Pick<CellIndex, 'near' | 'cell'>,
  source: StreamingSource,
  pulls: readonly (CoarserPull | null)[] = [],
  chain?: { pulled(cell: number): boolean },
) {
  const p = createPlanState(index, source, pulls, chain)
  const { out } = p
  return {
    plan: (
      eye: ArrayLike<number>,
      partitionGrids: readonly PartitionGrid[],
      placed: ReadonlyMap<number, unknown>,
      failed?: (url: string) => boolean,
      world?: LeafHolds,
      layers = true,
    ) => planFrame(p, eye, partitionGrids, placed, failed, world, layers),
    /** The last plan again, for a frame that makes none: its cells leaving and units waiting
     *  emptied, the rest — what it holds (`holds`) included — as the last frame left it. */
    replay() {
      out.leave.length = out.waiting.length = 0
      p.ranker.restart()
      return out
    },
    /** The cell files to read and place now: those of each unit `slots` loads, not `placed`. */
    files: (
      slots: Pick<LoadSlots, 'loading' | 'priorityOf'>,
      placed: ReadonlyMap<number, unknown>,
    ) => filesToRead(p, slots, placed),
    /** The priority the read of cell file `cell` asks by, as `files` gave it. */
    priority: (cell: number): number | undefined => p.readAt.get(cell),
  }
}
