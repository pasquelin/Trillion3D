/**
 * WHICH CELLS OF A PARTITIONED SCENE ARE WISHED, AND WHICH WAIT TO LOAD: the partition's
 * streaming policy over its cell files, one loading range per grid around the camera.
 *
 * Each grid streams its cells within its loading range of the camera, as the compiled root names
 * them (`TablePartition.hlod.grids`, `compiler/tables/partition/grid.rs`): a cell is wished while
 * the view's shape for that range meets the bounds it streams by — the box around its content, or
 * its square, as the partition's scheme says (`StreamingSource.meets`) —, tested in 2D, its up
 * axis dropped (glTF's up is `+Y`), unless the grids do not lie flat or the session culls the
 * square cells by height; and the coarser cells a wished one pulls in on a grid that asks it
 * (`coarser.ts`). A wished cell waits its turn by the level of its cell on its grid, which the
 * cook writes (`rankedCell`). A cell file of
 * objects in a layer belongs to its HLOD 0 cell — its objects are that cell's HLOD 0 actor, the
 * same meshes instanced, and the source meshes of their main grid cell —: it is placed while that
 * HLOD 0 cell loads, wished within its grid's range, which holds the main grid's. A cell file of
 * objects in no layer streams on the main grid alone. A unit wished and not loaded — an HLOD 0
 * cell some file of which is not placed, or a file of no layer not placed — waits its turn to load
 * (`waiting`, `LoadSlots`); one whose file is refused for good waits for nothing, said lost
 * (`LeafWish.lost`). An HLOD 0 cell is placed whole once every cell of it is placed and no page of
 * the index that could list one of its cells waits to be opened — one refused for good waits for
 * nothing. What draws each HLOD cell is its visibility (`../hlod/hlodCells.ts`,
 * `../dag/worlds/worldFollow.ts`). The camera's far plane plays no part.
 *
 * A placed file of an HLOD 0 cell leaves once that cell is neither wished nor visible — a cell is
 * unloaded only once it is made invisible —, a file of no layer once its cell is wished no more.
 * The pages of the cell index are walked within the farthest a placed cell lies (`placedReach`)
 * and closed past its keep sphere (`reach.ts`, `cellIndex.ts`).
 */
import { boxesOverlap } from '../../../../math/src/geometry/box.ts'
import { appendTo } from '../../../../math/src/sequence/counts.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { CellIndex, IndexPage } from './cellIndex.ts'
import { coarserKey, MAIN_GRID, NO_CELLS, type CoarserPull } from './coarser.ts'
import { keepRadius, placedReach } from './reach.ts'
import type { LoadingCell, LoadSlots } from './loadSlots.ts'
import type { StreamingSource } from './source.ts'

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

/** The key a cell file of no layer waits to load by (`LoadSlots`), apart from the chain's cells'
 *  ranks. */
export const fileKey = (cell: number) => -1 - cell
/** The cell file a key made by `fileKey` names. */
const fileOf = (key: number) => -1 - key

/** What ranks the cell of `grid` at `level` there streaming by `bounds` in the load order
 *  (`LoadingCell`), as `source` sees it: the half side of its bounds, its level, its grid's
 *  priority, its distances. */
export function rankedCell(
  key: number,
  bounds: ArrayLike<number>,
  [grid, level]: readonly [PartitionGrid, number],
  source: StreamingSource,
): LoadingCell {
  const extent = (bounds[3] - bounds[0]) / 2
  const cell = { key, extent, level, priority: grid.priority, distance: 0, raw: 0 }
  return source.ranked(bounds, 0, grid.range, cell)
}

/**
 * The plan of the frames of `index` as the view `source` streams it, its lists kept from frame to
 * frame. A frame (`plan`) from `eye`, over the partition's `grids`, the cells `placed` holds,
 * whether the read of a file — a page of the index, a cell file — is refused for good (`failed`,
 * by its address) and what a world DAG says of each HLOD 0 cell (`LeafHolds`, none without one)
 * gives the placed cells that leave (`leave`), the index pages to open within the walk, nearest
 * first (`pages`), each HLOD 0 cell met (`leaves`), the cell files of no layer whose cell is
 * wished, with the square it streams by (`alone`), the cells whose main grid cell is wished with
 * the square they stream by — their rows draw the source meshes, the others their HLOD 0 actor
 * (`main`) —, and the units wished and not loaded (`waiting`). The HLOD actors off (`layers`
 * false), every cell file streams on the main grid alone. Once the load slots took the frame's
 * units, `files` gives the cell files to read and place: those of each unit loading, not placed,
 * in the order the units started, each asked by its unit's priority (`priority`) — the queue
 * serves the reads of every cell, files and HLOD actors, in the order the units took their turn.
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
  const leaves = new Map<number, Leaf>(),
    pageDistances = new Map<IndexPage, number>()
  const mainPull = pulls[MAIN_GRID]
  /** On a main grid that pulls: the cells met this frame at each of its keys, the squares they
   *  stream by, the keys of those wished, and the keys pulled in. */
  const mainAt = new Map<number, number[]>(),
    squares = new Map<number, ArrayLike<number>>(),
    seeds: number[] = [],
    seen = new Set<number>()
  const out = {
    leave: [] as number[],
    pages: [] as IndexPage[],
    leaves,
    alone: new Map<number, ArrayLike<number>>(),
    main: new Map<number, ArrayLike<number>>(),
    waiting: [] as LoadingCell[],
  }
  const visible: number[] = [],
    readAt = new Map<number, number>()
  /** The frames planned, the grids, and whether the files of a layer stream with their HLOD 0
   *  cell — the HLOD actors on (`layers`). */
  let frame = 0,
    grids: readonly PartitionGrid[] = [],
    layered = true
  const nearestPage = (a: IndexPage, b: IndexPage) => pageDistances.get(a)! - pageDistances.get(b)!
  const visit = (cell: number, square: ArrayLike<number>, leafBox: ArrayLike<number> | null) => {
    const wished = source.meets(square, 0, grids[0].range)
    if (wished) out.main.set(cell, square)
    const record = index.cell(cell)
    if (mainPull) {
      const key = coarserKey(record.grid[0], record.grid[1], record.grid[2])
      appendTo(mainAt, key, cell)
      squares.set(cell, square)
      if (wished) seeds.push(key)
    }
    const hlod = record.hlod
    if (!hlod || !leafBox || !layered) {
      if (wished) out.alone.set(cell, square)
      return
    }
    const [h, , grid, rung] = hlod
    let met = leaves.get(h)
    if (!met)
      leaves.set(
        h,
        (met = {
          wished: false,
          placed: false,
          lost: false,
          cells: [],
          bounds: [],
          grid,
          rung,
          frame: -1,
        }),
      )
    if (met.frame !== frame) {
      met.frame = frame
      met.cells.length = 0
      met.grid = grid
      met.rung = rung
      met.bounds = leafBox
      met.wished = source.meets(leafBox, 0, grids[grid].range) || !!chain?.pulled(h)
    }
    met.cells.push(cell)
  }
  /** `cell`, met at coordinates a wished cell of the main grid pulls in, wished: its main grid
   *  cell, and its file of no layer or its HLOD 0 cell on the main grid. */
  const pulledIn = (cell: number) => {
    out.main.set(cell, squares.get(cell)!)
    const leaf = index.cell(cell).hlod
    if (!leaf || !layered) out.alone.set(cell, squares.get(cell)!)
    else if (leaf[2] === MAIN_GRID) leaves.get(leaf[0])!.wished = true
  }
  const unread = (page: IndexPage, distance: number) => {
    out.pages.push(page)
    pageDistances.set(page, distance)
  }
  /** Whether a page of the index the frame waits on could list a cell of `leaf`: its box holds
   *  the streaming bounds of every cell it lists (`partition.rs`). */
  let refused: ((url: string) => boolean) | undefined
  const awaited = (leaf: Leaf) => {
    for (const page of out.pages)
      if (!refused?.(page.slot.url) && boxesOverlap(page.box, 0, leaf.bounds, 0)) return true
    return false
  }
  return {
    plan(
      eye: ArrayLike<number>,
      partitionGrids: readonly PartitionGrid[],
      placed: ReadonlyMap<number, unknown>,
      failed?: (url: string) => boolean,
      world?: LeafHolds,
      layers = true,
    ) {
      frame++
      refused = failed
      grids = partitionGrids
      layered = layers
      out.leave.length = out.pages.length = out.waiting.length = 0
      out.alone.clear()
      out.main.clear()
      pageDistances.clear()
      mainAt.clear()
      squares.clear()
      seeds.length = 0
      const reach = placedReach(grids, source, pulls)
      index.near(eye, reach, keepRadius(reach), placed, visit, unread)
      if (mainPull) {
        seen.clear()
        for (const key of seeds)
          mainPull.pull(key, seen, (pulled) => {
            for (const cell of mainAt.get(pulled) ?? NO_CELLS) pulledIn(cell)
          })
      }
      for (const [h, leaf] of leaves) {
        if (leaf.frame !== frame) {
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
        leaf.placed = whole && !awaited(leaf)
        leaf.lost = lost
        // A cell some file of which is refused for good waits for nothing.
        if (leaf.wished && !whole && !lost)
          out.waiting.push(rankedCell(h, leaf.bounds, [grids[leaf.grid], leaf.rung], source))
      }
      for (const [cell, square] of out.alone) {
        const { url, grid } = index.cell(cell)
        if (!placed.has(cell) && !failed?.(url))
          out.waiting.push(rankedCell(fileKey(cell), square, [grids[0], grid[0]], source))
      }
      out.pages.sort(nearestPage)
      // A placed file leaves once its HLOD 0 cell is neither wished nor visible, a file of no
      // layer once its cell is wished no more.
      for (const cell of placed.keys()) {
        const hlod = layered && index.cell(cell).hlod
        const kept = hlod
          ? !!leaves.get(hlod[0])?.wished || !!world?.visible(hlod[0])
          : out.alone.has(cell)
        if (!kept) out.leave.push(cell)
      }
      return out
    },
    /** The cell files to read and place now: those of each unit `slots` loads, not `placed`, the
     *  units in the order they started, each file asked by its unit's priority (`priority`). */
    files(slots: Pick<LoadSlots, 'loading' | 'priorityOf'>, placed: ReadonlyMap<number, unknown>) {
      visible.length = 0
      readAt.clear()
      for (const key of slots.loading()) {
        const priority = slots.priorityOf(key)
        if (key < 0) {
          const cell = fileOf(key)
          if (out.alone.has(cell) && !placed.has(cell)) {
            visible.push(cell)
            readAt.set(cell, priority)
          }
          continue
        }
        const leaf = leaves.get(key)
        if (leaf?.frame !== frame) continue
        for (const cell of leaf.cells) {
          if (placed.has(cell)) continue
          visible.push(cell)
          readAt.set(cell, priority)
        }
      }
      return visible
    },
    /** The priority the read of cell file `cell` asks by, as `files` gave it: none for a file no
     *  unit loading names. */
    priority: (cell: number): number | undefined => readAt.get(cell),
  }
}
