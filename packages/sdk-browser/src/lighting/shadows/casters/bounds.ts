import { boxEmpty } from '../../../../../math/src/geometry/box.ts'
import type { PageRec } from '../../../geometry/selection/types.ts'
import type { WebgpuLightState } from '../../../frame/backend/state/lights.ts'
import { growClusterBox } from './spheres.ts'
import {
  rootOfPacked,
  type PlacementIndex,
  type Placements,
} from '../../../geometry/selection/placements.ts'

/** The flat world box a residence change is declared with, and its halves, allocated once. */
const changeBox = new Float64Array(6),
  changeMin = changeBox.subarray(0, 3),
  changeMax = changeBox.subarray(3, 6)

/**
 * A page entered residency or left it since the last plan: the scene is drawn at another
 * precision where it is, so the shadow maps of lights whose range touches this box
 * no longer describe it exactly and become candidates again. Without that, a settled map would
 * keep the shadow of a cluster that left, or ignore that of a cluster that arrived. A
 * residency change the cut reads (`atOnce`) stales its pages at the next plan, the camera moving
 * or not: a page kept with a superseded form of a surface shades the form the camera now
 * draws in patches. Another change of the representation waits for the camera to rest. The
 * declared box is that of the cluster's world sphere; a moving placement's (`moving`) leaves the
 * static layer as it is. A cluster is no instance: the diff of the instances' boxes
 * (`castDiff.ts`) never sees it come or go, so the CPU declares its box.
 */
export function noteResidenceChange(
  lights: WebgpuLightState,
  roots: Placements,
  placement: PlacementIndex,
  packed: number,
  rec: PageRec,
  moving?: boolean,
  atOnce = false,
) {
  const { store, changes } = lights
  if (!store.count) return
  const rank = rootOfPacked(placement, packed) ?? -1
  const onlyMoving = moving ?? (rank >= 0 && lights.mobility.moves(rank))
  boxEmpty(changeBox, 0)
  growClusterBox(rec, roots, changeBox, rank)
  if (atOnce) changes.residencyChanged(changeMin, changeMax, onlyMoving)
  else changes.representationChanged(changeMin, changeMax, onlyMoving)
}
