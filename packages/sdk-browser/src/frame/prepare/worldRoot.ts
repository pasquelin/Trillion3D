/**
 * THE WORLD'S HLOD IN THE WEBGPU CUT: each HLOD cell drawn by its placements or an HLOD actor,
 * through the one cut.
 *
 * The world the scene's manifest opened (`EngineContext.worldRoots`) and the stream it read at load
 * (`drawn`) give the cut its last roots, one per placement of its model
 * (`../../geometry/hlod/worldRecords.ts`), worn in its actors' flattened materials: their shared pages
 * join the catalogue — requested, held by
 * the pool and drawn as any page —, its geometry pages read as any geometry page
 * (`../../geometry/hlod/worldRuns.ts`), and each placed row links to the HLOD 0 cell it lies in
 * (`cellOfRoot`), whose one representation the cut follows (`../../geometry/dag/worlds/worldLinks.ts`). A
 * world whose packing would pass the pages the cut's per-page state tells apart (`SPARSE_IDS`) is
 * not packed: the scene keeps its GPU cut, its cells drawn by their placements alone. The roots
 * each HLOD cell holds join the cover the cut's cache keeps resident while it holds them
 * (`coverHeldRoots`).
 */
import type { EngineContext } from '../../session/engine/types.ts'
import type { PageRec, ClusterRoot } from '../../geometry/selection/types.ts'
import { indexPageRequests } from '../../geometry/selection/requests.ts'
import { worldSelectionRoots, type WorldHeld } from '../../geometry/hlod/worldRecords.ts'
import type { WorldRootsHold } from '../../geometry/hlod/worldRoots.ts'
import { SPARSE_IDS } from '../../geometry/cut/sparseInts.ts'
import { rowCell, rowDrawnAs, type RowCell } from '../../geometry/partition/rowCells.ts'
import type { CellLink } from '../../geometry/dag/worlds/worldCells.ts'
import type { GpuSelection } from '../../gpu/core/selection.ts'
import type { PlacementRows } from '../../placement/rows/rows.ts'
import type { WebgpuPagesCore } from '../backend/runtime.ts'
import type { WebgpuResidencySets } from '../../geometry/residency/sets.ts'

type Collected = {
  roots: ClusterRoot<PageRec>[]
  allPages: PageRec[]
  requests: Map<string, number>
}

/** A root of the world DAG among the cut's: they share their pages and held roots. */
export const isWorldRoot = <R extends object>(root: R): root is R & WorldHeld => 'hlod' in root

/** Whether the world DAG's pages, once per placement of its model (`instances`), and the pages
 *  every root places stay within the ids the cut keys its per-page state by (`SPARSE_IDS`):
 *  packed, each is one id. */
export function worldFits(
  dag: { readonly pages: readonly unknown[] },
  roots: readonly ClusterRoot<PageRec>[],
  instances = 1,
) {
  const placed = roots.reduce((sum, root) => sum + root.pages.length, 0)
  return placed + instances * dag.pages.length <= SPARSE_IDS
}

/** How many roots the world DAG `hold` draws takes: one per row of its pose, one without. */
export const worldInstances = (hold: WorldRootsHold) => hold.pose?.capacity ?? 1

/**
 * The cut's roots of the world DAG `hold` draws, one per placement of its model: its pages worn in
 * its actors' flattened materials (`WorldRootsHold.surfaces`), drawn after every root of `roots`,
 * each at its placement's pose; none when no actor has a surface.
 */
export function worldDagRoots(hold: WorldRootsHold, roots: readonly ClusterRoot<PageRec>[]) {
  const order = roots.reduce((most, root) => Math.max(most, root.pages[0]?.renderOrder ?? 0), 0)
  return worldSelectionRoots(hold.dag!, hold.surfaces, order + 1, hold.pose)
}

/**
 * `collected`, the host scene's roots and pages, with the world DAG's roots last — one per
 * placement of its model — and its pages, once, after every other, the request ranks indexed
 * again; as it was without a world to draw.
 */
export function withWorldRoot<T extends Collected>(collected: T, context: EngineContext): T {
  const hold = context.worldRoots,
    dag = hold?.dag
  if (!hold || !dag) return collected
  const { roots, allPages } = collected
  if (!worldFits(dag, roots, worldInstances(hold))) return collected
  const placed = worldDagRoots(hold, roots)
  if (!placed.length) return collected
  roots.push(...placed)
  for (const page of placed[0].pages) allPages.push(page)
  return { ...collected, requests: indexPageRequests(allPages) }
}

/** No cell: `cellOfRoot`'s answer for a root no partition cell placed. */
const NO_CELL: CellLink = [-1, 0, -1, false, false]
/** The link `linkOf` fills and gives for a row in a cell: every caller consumes it before it asks
 *  for another. */
const link: CellLink = [-1, 0, -1, false, false]

/**
 * Where row `at` lies (`CellLink`, `../../geometry/partition/rowCells.ts`): its HLOD 0 cell, -1
 * for none — a node no cell placed (a core node, always loaded) —, the instance of the world DAG
 * it lies in — the placement of its model whose cell placed it —, its cell file, and whether that
 * file's main cell is wished: drawn as the source mesh, not as its HLOD 0 actor; or the HLOD cell
 * whose instanced actor it is a row of (`RowCell.actor`).
 */
const linkOf = (at: RowCell | undefined): CellLink => {
  if (!at) return NO_CELL
  link[0] = at.hlod
  link[1] = at.instance ?? 0
  link[2] = at.cell
  link[3] = !at.proxy
  link[4] = at.actor !== undefined
  return link
}

/** Where root `root`'s row lies (`linkOf`): in none for a parked row or a page-less root. */
function cellOfRoot(root: ClusterRoot<PageRec>): CellLink {
  const placement = root.placement
  if (!placement || root.parked || !root.pages[0]) return NO_CELL
  return linkOf(rowCell(placement.rows, placement.index))
}

/** Each placement of `roots` the new `cut` packs lies in the HLOD 0 cell and the cell file its row
 *  lies in now, as a row moved later tells it (`linkWorldCell`): a cut made at open, or for a
 *  growth. Nothing for a cut that packs no world DAG. */
export function linkWorldCells(cut: GpuSelection, roots: readonly ClusterRoot<PageRec>[]) {
  if (!cut.world) return
  for (let rank = 0; rank < roots.length; rank++) cut.placeInCell(rank, ...cellOfRoot(roots[rank]))
}

/** Row `index` of `rows`, whose root is `rank` (-1 for none yet), told to `rt`'s cut: a row whose
 *  root a growth will bring counts in its HLOD 0 cell — a row of an instanced actor in that actor
 *  — and its cell file as a placement not resident until then; one the blend pass draws never
 *  gets a root, and waits for none. Nothing when the cut packs no world DAG. */
export function waitWorldRow(
  rt: { run: { gpuSelection?: GpuSelection } },
  rows: PlacementRows,
  index: number,
  rank: number,
) {
  const cut = rt.run.gpuSelection
  if (!cut?.world) return
  const [cell, instance = 0, file, , actor] = linkOf(
    rank < 0 && !rows.blended ? rowCell(rows, index) : undefined,
  )
  cut.waitRow(rows, index, cell, instance, file, actor)
}

/** The HLOD level each placement root drew as when its record was last made: set by the making
 *  alone (`rowWrittenAs`). */
const drawnBefore = new WeakMap<object, number>()

/** The HLOD level placement root `rank` of `roots` draws as (`rowDrawnAs`), read as its record is
 *  made, and kept: what `linkWorldCell` compares a move with. It names the clusters' diagnostic word
 *  alone (`diagnosticDrawnAs`), never what draws. */
export function rowWrittenAs(roots: readonly ClusterRoot<PageRec>[], rank: number) {
  const root = roots[rank],
    placement = root?.placement
  const level = rowDrawnAs(placement && rowCell(placement.rows, placement.index))
  if (root) drawnBefore.set(root, level)
  return level
}

/** Placement `rank` of `rt`'s cut lies where its row lies now (`cellOfRoot`): told where its row's
 *  cell moved (`takeCellsMoved`) or the row was parked or taken (`flipWorld`); nothing when it
 *  packs no world DAG. A placement that turned to draw as another HLOD level — its cell's HLOD 0
 *  actor or back to its source mesh (`RowCell.proxy`) —, has its record made again: the decode
 *  of its clusters names what draws in their diagnostic word (`diagnosticDrawnAs`). */
export function linkWorldCell(
  rt: {
    layout: {
      selectionRoots: ClusterRoot<PageRec>[]
      clusters?: Pick<WebgpuPagesCore['layout']['clusters'], 'placementInfo'>
    }
    run: { gpuSelection?: GpuSelection }
  },
  rank: number,
) {
  const cut = rt.run.gpuSelection,
    root = rt.layout.selectionRoots[rank]
  if (!root) return
  if (cut?.world) cut.placeInCell(rank, ...cellOfRoot(root))
  const placement = root.placement,
    clusters = rt.layout.clusters
  if (!clusters || !placement) return
  const level = rowDrawnAs(rowCell(placement.rows, placement.index))
  // Against what its record was made with: made again until it says it.
  if ((drawnBefore.get(root) ?? -1) === level) return
  clusters.placementInfo.mark(rank)
}

/**
 * Follows on `sets` the holders the world's held HLOD cells add to the root cover
 * (`../../geometry/residency/coverHolders.ts`): each HLOD cell's actor's roots (`pack.rs`) in each bundle
 * the cells start or stop holding (`../../geometry/hlod/worldBundles.ts`), as the packed world DAG names
 * them. Each move wakes the next image, which loads them. A cell let go takes its roots out with
 * it. The backend gone, the cover lets go of them all.
 * Nothing without a packed world DAG.
 */
export function coverHeldRoots(
  rt: Pick<WebgpuPagesCore, 'context' | 'layout' | 'signal' | 'run'>,
  sets: Pick<WebgpuResidencySets, 'holdCover'>,
) {
  const world = rt.context.worldRoots,
    root = rt.layout.selectionRoots.find(isWorldRoot)
  if (!world || !root) return
  const cover = (bundle: number, held: boolean) => {
    const pages = root.pagesOf(bundle)
    if (!pages.length) return
    sets.holdCover(pages, held)
    rt.run.gate.resourcesChanged()
  }
  const unwatch = world.watch(cover)
  const end = () => {
    unwatch()
    for (const bundle of world.held()) cover(bundle, false)
  }
  rt.signal.addEventListener('abort', end, { once: true })
}
