import type { GpuSelection } from '../../../gpu/core/selection.ts'
import { joined } from '../../../../../sdk-core/src/runtime/joined.ts'
import { createDagResidencyUpload } from '../residencyUpload.ts'
import { createDagDispatch } from '../dispatch.ts'
import { createDagRuntimeState } from './runtimeState.ts'
import { createTreeFollower } from '../tree/treeFollow.ts'
import { createLinkFollower } from '../worlds/worldFollow.ts'
import { voidCuts, type DagRun, type RootsOnGpu } from './runtimeOps.ts'
import type { DagResources } from '../resources.ts'
import { createPlacementBoxes } from '../placement/placementBoxes.ts'
import { followRecords } from '../recordsFollow.ts'
import {
  selectionCut,
  selectionPlacements,
  selectionPoses,
  selectionBoxes,
  selectionTables,
  selectionWorlds,
} from './runtimeFace.ts'

export function createDagRuntime(
  resources: DagResources,
  /** The session's roots on the GPU: the stretch's one writer and the tree's leaves. */
  roots: RootsOnGpu,
): GpuSelection {
  const state = createDagRuntimeState()
  const run: DagRun = {
    resources,
    state,
    // The cut rule's residency, derived from the pool's and uploaded by difference.
    uploadResidency: createDagResidencyUpload(resources),
    ...createDagDispatch(resources, state),
    tree: createTreeFollower(resources, roots.leaves),
    // The placements' world boxes, which the probes follow (`../placement/placementBoxes.ts`).
    boxes: createPlacementBoxes(
      resources.packed,
      Math.max(1, resources.packed.worldCount),
      () => resources.packed.live?.worlds ?? resources.packed.worldSources.length,
    ),
    // Each HLOD cell's one representation (`../worlds/worldFollow.ts`).
    links: createLinkFollower(resources),
    moves: new Int32Array(8),
  }
  return selectionOver(run, roots)
}

/** The camera cut's face (`GpuSelection`) over `run`. */
function selectionOver(run: DagRun, roots: RootsOnGpu): GpuSelection {
  const { resources, state, links } = run
  const { frames } = resources
  const live = () => !state.disposed && !state.dead
  // The one step every cut on these tables takes before it encodes, the main view's and each view
  // aside's: the root and mark words parked or marked since go up (`flushWords`), the roots'
  // worlds, boxes and stretches are written, the tree fits what moved again over their leaves, the
  // world's links and cell states that moved go up — a cut made before them is not the cut now,
  // the main view's and each view aside's alike (`sameCut`).
  const syncTables = () => {
    if (!live()) return
    frames.flushWords()
    roots.roots(frames.rows)
    run.tree?.sync()
    // The cut's groups follow the placements' records they bind, made again only for another view.
    followRecords(resources)
    if (links?.sync()) voidCuts(state, false)
  }
  return joined(
    selectionTables(run),
    selectionPoses(run, live),
    selectionWorlds(run, live),
    selectionPlacements(run, live),
    selectionBoxes(run, live),
    selectionCut(run, live, syncTables),
  )
}
