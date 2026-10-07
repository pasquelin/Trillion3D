/**
 * THE WORLD DAG IN THE WEBGPU CUT: the far field of a partitioned world, its cells held far
 * drawn by their super-roots and the regions above them, through the one cut.
 *
 * The world a manifest opened (`../../../scene/worldRoots.ts`, `worldRootsOf`) and the stream it read
 * at load (`drawn`) give the cut its last root (`../../../scene/worldRecords.ts`): its pages join
 * the catalogue — requested, held by the pool and drawn as any page —, its geometry pages read
 * through the world page source (`readWorldOrGeometry`), and each placed row links to the object it
 * draws (`objectOfRoot`), which its world group stands in for (`../../../gpu/dag/worldLinks.ts`).
 * A world whose packing would pass the pages a key word names (`KEY_PAGE_MAX`) is not
 * packed: the scene keeps its GPU cut, its far cells unheld (`../../../partition/farCells.ts`). The
 * roots each held cell alone needs join the cover the cut's cache keeps resident (`coverHeldRoots`).
 */
import type { EngineContext } from '../../../engine/types.ts'
import type { PageRec, ClusterRoot } from '../../../page/selection/types.ts'
import { indexPageRequests } from '../../../page/selection/requests.ts'
import { worldRootsOf } from '../../../scene/worldRoots.ts'
import { worldSelectionRoot, worldWearers } from '../../../scene/worldRecords.ts'
import { WORLD_ROOTS_BIN } from '../../../../../sdk-core/src/manifest/worldRoots.ts'
import { KEY_PAGE_MAX } from '../../../gpu/dag/evict.ts'
import { rowCell } from '../../../partition/rowCells.ts'
import type { GpuSelection } from '../../../gpu/core/selection.ts'
import type { WebgpuPagesCore } from '../runtime.ts'
import type { WebgpuResidencySets } from '../../residency/sets.ts'
import { isWorldRoot } from './layout.ts'

type Collected = {
  roots: ClusterRoot<PageRec>[]
  allPages: PageRec[]
  requestCount: number
}

/** The world DAG the cut packs for `context`'s scene: the stream a partitioned world drew at load. */
const drawnWorld = (context: Pick<EngineContext, 'metadata'>) =>
  worldRootsOf(context.metadata)?.drawn?.dag

/**
 * `collected`, the host scene's roots and pages, with the world DAG as the last root and its pages
 * after every other, the request ranks indexed again; as it was without a world to draw.
 */
export function withWorldRoot<T extends Collected>(collected: T, context: EngineContext): T {
  const dag = drawnWorld(context)
  if (!dag) return collected
  const { roots, allPages } = collected
  const instances = roots.reduce((sum, root) => sum + root.pages.length, 0)
  if (instances + dag.pages.length > KEY_PAGE_MAX) return collected
  const order = roots.reduce((most, root) => Math.max(most, root.pages[0]?.renderOrder ?? 0), 0)
  const wear = worldWearers(context.source, context.metadata.primitives, context.associations)
  const root = worldSelectionRoot(dag, wear, order + 1)
  if (!root) return collected
  roots.push(root)
  for (const page of root.pages) allPages.push(page)
  return { ...collected, requestCount: indexPageRequests(allPages) }
}

/** The geometry page reader of `context`, a world page read through the world's own source. */
export function readWorldOrGeometry(context: EngineContext) {
  const read = context.readGeometryPage
  return (url: string, signal?: AbortSignal, priority?: number) => {
    const world = url.startsWith(`${WORLD_ROOTS_BIN}#`) && worldRootsOf(context.metadata)?.drawn
    if (world) return world.source.read(url, signal)
    if (!read) return Promise.reject(new Error('Missing geometry page reader'))
    return read(url, signal, priority)
  }
}

/**
 * The world object root `root` draws, -1 for none: a parked row, a blended page, a node no cell
 * placed, or one the cook continued nothing of (`../../../scene/worldObjects.ts`).
 */
function objectOfRoot(context: EngineContext, root: ClusterRoot<PageRec>) {
  const objects = worldRootsOf(context.metadata)?.objects,
    placement = root.placement,
    rec = root.pages[0]
  if (!objects || !placement || root.parked || !rec || rec.transparent) return -1
  const at = rowCell(placement.rows, placement.index),
    association = rec.sourceMesh && context.associations.get(rec.sourceMesh)
  if (!at || association?.meshes === undefined) return -1
  const primitive = association.primitives ?? 0
  return objects.objectOf(at.cell, at.node, at.meshes, association.meshes, primitive)
}

/** Each placement of `roots` the new `cut` packs draws the object its row places now, as a row
 *  moved later tells it (`linkWorldObject`): a cut made at open, or for a growth. */
export function linkWorldObjects(
  context: EngineContext,
  cut: GpuSelection,
  roots: readonly ClusterRoot<PageRec>[],
) {
  if (!cut.placeObject) return
  for (let rank = 0; rank < roots.length; rank++)
    cut.placeObject(rank, objectOfRoot(context, roots[rank]))
}

/** Placement `rank` of `rt`'s cut draws the object its row places now (`objectOfRoot`). */
export function linkWorldObject(
  rt: {
    context: EngineContext
    layout: { selectionRoots: ClusterRoot<PageRec>[] }
    run: { gpuSelection?: GpuSelection }
  },
  rank: number,
) {
  const placeObject = rt.run.gpuSelection?.placeObject,
    root = rt.layout.selectionRoots[rank]
  if (placeObject && root) placeObject(rank, objectOfRoot(rt.context, root))
}

/**
 * Follows on `sets` the holders the world's held cells add to the root cover
 * (`../../residency/coverHolders.ts`): the roots one cell alone needs — a lone object's copy, the
 * top of a material only that cell wears, a cell's super-root no top continued (`top.rs`) — in
 * each bundle the cells start or stop holding (`../../../scene/worldHeldBundles.ts`), as the
 * packed world DAG names them. Each move wakes the next image, which loads them. The room the cover
 * leaves past the floor's other pages bounds them: the plan holds no far cell whose roots would
 * pass it (`cover`). A cell let go past the keep sphere takes its roots out with it: the far
 * field beyond the keep sphere is not this cover's. The backend gone, the cover lets go of them
 * all. Nothing without a packed world DAG: the GPU cut, the engine's one cut, draws the world root
 * whole session long.
 */
export function coverHeldRoots(
  rt: Pick<WebgpuPagesCore, 'context' | 'layout' | 'signal' | 'run' | 'setup'>,
  sets: Pick<WebgpuResidencySets, 'holdCover'>,
  room: () => number,
) {
  const world = worldRootsOf(rt.context.metadata),
    dag = world?.drawn?.dag,
    root = rt.layout.selectionRoots.find(isWorldRoot)
  if (!world || !dag || !root) return
  /** The roots of each bundle the cells hold now. */
  const covered = new Map<number, PageRec[]>()
  const cover = (pages: readonly PageRec[], held: boolean) => {
    sets.holdCover(pages, held)
    rt.run.gate.resourcesChanged()
  }
  const unwatch = world.watch((bundle, held) => {
    // A root no mesh wears is a record without a page (`worldRecords.ts`): nothing to hold.
    const pages = (dag.held.get(bundle) ?? []).map((rank) => root.pages[rank]).filter((p) => p.url)
    if (!pages.length) return
    if (held) covered.set(bundle, pages)
    else covered.delete(bundle)
    cover(pages, held)
  })
  // The floor's pages past the session's cover: the pages its roots' groups replace.
  const children = rt.setup.floorPages - rt.setup.bootstrap.length
  world.cover.room = () => Math.max(0, room() - children)
  const end = () => {
    unwatch()
    for (const pages of covered.values()) cover(pages, false)
    covered.clear()
    world.cover.room = undefined
  }
  rt.signal.addEventListener('abort', end, { once: true })
}
