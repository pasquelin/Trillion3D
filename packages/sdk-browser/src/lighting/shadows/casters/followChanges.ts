/**
 * THE CHANGES NO PLACEMENT SAYS, declared by the CPU as the boxes of the clusters they touch: a
 * surface's alpha mode or cutoff moved, a world cell switched between its placements and its HLOD
 * actor, a root drawn at other distances — what the reference treats as a primitive or material
 * update. The diff of the instances' boxes (`castDiff.ts`) sees a placement move, appear or leave; it cannot see a cluster's shadow
 * change where it stands, so the cluster's sphere is boxed here (`growClusterBox`) and entered into
 * the world's changes (`WebgpuLightState.changes`), which the invalidation reads beside the diff's
 * list. Streaming — a cluster entering or leaving residency, a colour tile arriving — declares
 * nothing here: it is the cull's own channel, behind `shadowInvalidateOnLodDelta`.
 */
import { boxEmpty, boxesOverlap, boxUnion } from '../../../../../math/src/geometry/box.ts'
import type { PageSurface } from '../../../geometry/pages/surface.ts'
import type { PageRec } from '../../../geometry/selection/types.ts'
import { rootOfPacked } from '../../../geometry/selection/placements.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { rootWorldBox, worldStretch } from '../../../geometry/selection/rootWorld.ts'
import { growClusterBox } from './spheres.ts'

/** What the followers read of the runtime: the lights' changes and mobility, and the layout's
 *  clusters. */
export type FollowRuntime = Pick<WebgpuPagesRuntime, 'lights' | 'layout'> & {
  run?: Pick<WebgpuPagesRuntime['run'], 'gpuSelection'>
}

/** Enters the flat box `box` into the world's changes (`WebgpuLightState.changes`), for the moving
 *  casters' layer alone where `movingOnly`. */
function changeBox(lights: FollowRuntime['lights'], box: Float64Array, movingOnly: boolean) {
  lights.changes.worldChanged(box.subarray(0, 3), box.subarray(3, 6), movingOnly)
}

/** The box of the resident clusters of each root that `wants` names, one a root: scratch, rewritten
 *  by each call. */
const perRoot = new Map<number, Float64Array>()

/**
 * Declares, for each root with a resident cluster whose record `wants`, the box of those clusters:
 * the pages over them go stale at the next plan, only the moving casters' layer when the root already
 * moves or deforms. One scan of the resident clusters a call.
 */
function declareResident(rt: FollowRuntime, wants: (rec: PageRec) => boolean) {
  const { lights, layout } = rt
  if (!lights.store.count) return
  const { pages, count } = layout.clusters.residentPages()
  perRoot.clear()
  for (let i = 0; i < count; i++) {
    const page = pages[i],
      rec = layout.recordOf(page)
    if (!rec || rec.transparent || !wants(rec)) continue
    const rank = rootOfPacked(layout.placement, page)
    if (rank < 0) continue
    let box = perRoot.get(rank)
    if (!box) {
      box = new Float64Array(6)
      boxEmpty(box, 0)
      perRoot.set(rank, box)
    }
    growClusterBox(rec, layout.selectionRoots, box, rank)
  }
  for (const [rank, box] of perRoot) changeBox(lights, box, lights.mobility.cachedDynamic(rank))
  perRoot.clear()
}

/**
 * Surfaces whose alpha mode or cutoff a page changed: the depth their clusters cast is no longer
 * the one drawn, whether they cut it before or not: the shadow pages over those clusters alone are
 * drawn again at once, as a node shown or hidden is, not when the camera rests.
 */
export function shadowsFollowSurfaces(rt: FollowRuntime, surfaces: ReadonlySet<PageSurface>) {
  declareResident(rt, (rec) => surfaces.has(rec.material as PageSurface))
}

/** The box being merged by `shadowsFollowCells`: the cluster boxes of one run of a cell, joined while
 *  they overlap, scratch. */
const run = new Float64Array(6),
  incoming = new Float64Array(6)

/**
 * The world's cells that switched between their placements and their HLOD actors since the last
 * image (`GpuSelection.switchedPages`): the clusters of the representation a cell draws now cast
 * where they stand, those of the one it left no more — the casters obey the cut's switch
 * (`../../../geometry/dag/shader/worldGateWgsl.ts`, `worldDraws`) —, so the box of each is entered
 * into the world's changes, the boxes of a cell's clusters merged while they overlap: the pages it
 * covers are drawn again in the same image, as a primitive added or removed stales its bounds.
 */
export function shadowsFollowCells(rt: FollowRuntime) {
  const { lights, layout } = rt,
    selection = rt.run?.gpuSelection
  if (!selection || !lights.store.count) return
  let open = false,
    movingRun = false
  const flush = () => {
    if (open) changeBox(lights, run, movingRun)
    open = false
  }
  selection.switchedPages((world, rank) => {
    const page = layout.placement.baseOfRoot[world] + rank,
      rec = layout.recordOf(page)
    if (!rec) return
    boxEmpty(incoming, 0)
    growClusterBox(rec, layout.selectionRoots, incoming, world)
    const moving = lights.mobility.cachedDynamic(world)
    if (open && moving === movingRun && boxesOverlap(run, 0, incoming, 0))
      boxUnion(run, 0, incoming[0], incoming[1], incoming[2], incoming[3], incoming[4], incoming[5])
    else {
      flush()
      run.set(incoming)
      open = true
      movingRun = moving
    }
  })
  flush()
}

/** The box of a root drawn at other distances, grown by its reach: scratch. */
const reached = new Float64Array(6)

/**
 * Root `rank` is drawn at other distances than before (`ClusterRoot.drawDistance`): the instances
 * the casters cull change where the root stands, so its world box, grown by its reach as the diff of
 * the instances' boxes grows it, is entered into the world's changes and the pages it lies in are
 * drawn again, the moving casters' layer alone for a root already moving; the root is cached as
 * dynamic from now on, as the reference's updated primitive is (`mobility.invalidate`). A root
 * parked casts nothing: none.
 */
export function shadowsFollowDrawDistance(rt: FollowRuntime, rank: number) {
  const { lights, layout } = rt,
    root = layout.selectionRoots[rank]
  if (root.parked) return
  const box = rootWorldBox(root)
  // Asked before the root is made dynamic: its first update stales both layers.
  const movingOnly = lights.mobility.cachedDynamic(rank)
  lights.mobility.invalidate(rank)
  if (!box || !lights.store.count) return
  // Its reach is in its own units: the world stretches it.
  const reach = root.reach ? root.reach * worldStretch(root) : 0
  for (let k = 0; k < 3; k++) {
    reached[k] = box[k] - reach
    reached[3 + k] = box[3 + k] + reach
  }
  changeBox(lights, reached, movingOnly)
}
