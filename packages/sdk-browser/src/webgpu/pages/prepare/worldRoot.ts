/**
 * THE WORLD'S HLOD IN THE WEBGPU CUT: each HLOD cell drawn by its placements or an HLOD actor,
 * through the one cut.
 *
 * The world the scene's manifest opened (`EngineContext.worldRoots`) and the stream it read at load
 * (`drawn`) give the cut its last roots, one per placement of its model
 * (`../../../scene/worldRecords.ts`), worn in its actors' flattened materials: their shared pages
 * join the catalogue — requested, held by
 * the pool and drawn as any page —, its geometry pages read as any geometry page
 * (`../../../scene/worldRuns.ts`), and each placed row links to the HLOD 0 cell it lies in
 * (`cellOfRoot`), whose one representation the cut follows (`../../../gpu/dag/worldLinks.ts`). A
 * world whose packing would pass the pages a key word names (`KEY_PAGE_MAX`) is not packed: the
 * scene keeps its GPU cut, its cells drawn by their placements alone. The roots each HLOD cell
 * holds join the cover the cut's cache keeps resident while it holds them (`coverHeldRoots`).
 */
import type { EngineContext } from '../../../engine/types.ts'
import type { PageRec, ClusterRoot } from '../../../page/selection/types.ts'
import { indexPageRequests } from '../../../page/selection/requests.ts'
import { worldSelectionRoots, type WorldHeld } from '../../../scene/worldRecords.ts'
import type { WorldRootsHold } from '../../../scene/worldRoots.ts'
import { KEY_PAGE_MAX } from '../../../gpu/dag/evict.ts'
import { rowCell } from '../../../partition/rowCells.ts'
import type { GpuSelection } from '../../../gpu/core/selection.ts'
import type { PlacementRows } from '../../../placement/rows.ts'
import type { WebgpuPagesCore } from '../runtime.ts'
import type { WebgpuResidencySets } from '../../residency/sets.ts'

type Collected = {
  roots: ClusterRoot<PageRec>[]
  allPages: PageRec[]
  requests: Map<string, number>
}

/** A root of the world DAG among the cut's: they share their pages and held roots. */
export const isWorldRoot = <R extends object>(root: R): root is R & WorldHeld => 'hlod' in root

/** Whether the world DAG's pages, once per placement of its model (`instances`), and the pages
 *  every root places stay within the keys a page names (`KEY_PAGE_MAX`): packed, the cut keeps
 *  them one key each. */
export function worldFits(
  dag: { readonly pages: readonly unknown[] },
  roots: readonly ClusterRoot<PageRec>[],
  instances = 1,
) {
  const placed = roots.reduce((sum, root) => sum + root.pages.length, 0)
  return placed + instances * dag.pages.length <= KEY_PAGE_MAX
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
const NO_CELL = [-1, 0] as const

/**
 * The HLOD 0 cell root `root`'s row lies in, -1 for none — a parked row, a page-less root, a node no
 * cell placed (a core node, always loaded) —, and the instance of the world DAG it lies in: the
 * placement of its model whose cell placed its row (`../../../partition/rowCells.ts`).
 */
function cellOfRoot(root: ClusterRoot<PageRec>) {
  const placement = root.placement
  if (!placement || root.parked || !root.pages[0]) return NO_CELL
  const at = rowCell(placement.rows, placement.index)
  return at ? ([at.hlod, at.instance ?? 0] as const) : NO_CELL
}

/** Each placement of `roots` the new `cut` packs lies in the HLOD 0 cell its row lies in now, as
 *  a row moved later tells it (`linkWorldCell`): a cut made at open, or for a growth. Nothing for a
 *  cut that packs no world DAG. */
export function linkWorldCells(cut: GpuSelection, roots: readonly ClusterRoot<PageRec>[]) {
  if (!cut.world) return
  for (let rank = 0; rank < roots.length; rank++) cut.placeInCell(rank, ...cellOfRoot(roots[rank]))
}

/** Row `index` of `rows`, whose root is `rank` (-1 for none yet), told to `rt`'s cut: a row whose
 *  root a growth will bring counts in its HLOD 0 cell as a placement not resident until then; one
 *  the blend pass draws never gets a root, and waits for none. Nothing when the cut packs no world
 *  DAG. */
export function waitWorldRow(
  rt: { run: { gpuSelection?: GpuSelection } },
  rows: PlacementRows,
  index: number,
  rank: number,
) {
  const cut = rt.run.gpuSelection
  if (!cut?.world) return
  const at = rank < 0 && !rows.blended ? rowCell(rows, index) : undefined
  cut.waitRow(rows, index, at ? at.hlod : -1, at?.instance ?? 0)
}

/** Whether each placement root drew as its cell's HLOD 0 actor when its rows were last written:
 *  set by the writing alone (`rowWrittenAsProxy`). */
const drawnAsProxy = new WeakMap<object, boolean>()

/** Whether placement root `rank` of `roots` draws as its cell's HLOD 0 actor (`RowCell.proxy`),
 *  read as a row of it is written, and kept: what `linkWorldCell` compares a move with. It names the
 *  row's diagnostic word alone (`pageDiagnosticWord`), never what draws. */
export function rowWrittenAsProxy(roots: readonly ClusterRoot<PageRec>[], rank: number) {
  const root = roots[rank],
    placement = root?.placement
  const proxy = !!placement && !!rowCell(placement.rows, placement.index)?.proxy
  if (root) drawnAsProxy.set(root, proxy)
  return proxy
}

/** Placement `rank` of `rt`'s cut lies in the HLOD 0 cell its row lies in now (`cellOfRoot`): told
 *  where its row's cell moved (`takeCellsMoved`) or the row was parked or taken (`flipWorld`);
 *  nothing when it packs no world DAG. A placement that turned to draw as its cell's HLOD 0 actor,
 *  or back to its source mesh (`RowCell.proxy`), has its page rows written again: their diagnostic
 *  word names what draws (`pageDiagnosticWord`). */
export function linkWorldCell(
  rt: {
    layout: {
      selectionRoots: ClusterRoot<PageRec>[]
      rows?: Pick<WebgpuPagesCore['layout']['rows'], 'rowOf' | 'touchPage'>
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
    rows = rt.layout.rows
  if (!rows || !placement) return
  const proxy = !!rowCell(placement.rows, placement.index)?.proxy
  // Against what its rows were written with: they are written again until they say it.
  if ((drawnAsProxy.get(root) ?? false) === proxy) return
  const base = root.packedBase ?? -1
  if (base < 0) return
  for (let page = 0; page < root.pages.length; page++)
    if (rows.rowOf(base + page) >= 0) rows.touchPage(base + page)
}

/**
 * Follows on `sets` the holders the world's held HLOD cells add to the root cover
 * (`../../residency/coverHolders.ts`): each HLOD cell's actor's roots (`pack.rs`) in each bundle
 * the cells start or stop holding (`../../../scene/worldBundles.ts`), as the packed world DAG names
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
