/**
 * THE CHANGES NO PLACEMENT SAYS, declared by the CPU as the boxes of the clusters they touch: a
 * surface's alpha mode or cutoff moved, a world cell switched between its placements and its HLOD
 * actor — what the reference treats as a primitive or material update. The diff of the instances'
 * boxes (`castDiff.ts`) sees a placement move, appear or leave; it cannot see a cluster's shadow
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
import { growClusterBox } from './spheres.ts'

/** What the followers read of the runtime: the lights' changes and mobility, and the layout's
 *  clusters. */
export type FollowRuntime = Pick<WebgpuPagesRuntime, 'lights' | 'layout'> & {
  run?: Pick<WebgpuPagesRuntime['run'], 'gpuSelection'>
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
  for (const [rank, box] of perRoot)
    lights.changes.worldChanged(
      box.subarray(0, 3),
      box.subarray(3, 6),
      lights.mobility.cachedDynamic(rank),
    )
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
    if (open) lights.changes.worldChanged(run.subarray(0, 3), run.subarray(3, 6), movingRun)
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
