/** The per-page half of the cut's descent: a leaf's clusters tested and kept (`visit.ts`). */
import { coneSkipsPage } from '../cone/cone.fixture.ts'
import { frustumClipBox } from '../../../../sdk-core/src/index.ts'
import { framePixels } from '../selection/frame.fixture.ts'
import { drawsCluster } from './rule.fixture.ts'
import {
  fitPacked,
  selectionScratch,
  type PageRecord,
  type SelectionState,
} from './state.fixture.ts'

/** Frustum test of a page's world box against the selection planes. */
function clipRecordBox(min: readonly number[], max: readonly number[]) {
  return frustumClipBox(selectionScratch.planes, min[0], min[1], min[2], max[0], max[1], max[2])
}

/** Keep a cluster in the requested cut when `wanted`, in the drawn one when `drawn`. A requested
 *  cluster not drawn leaves the cut incomplete: its nearest resident ancestor stands in for it.
 *  The record decides; its packed rank and its root rank name the instance, rank by rank. */
function keep<T extends PageRecord>(
  s: SelectionState<T>,
  rec: T,
  index: number,
  wanted: boolean,
  drawn: boolean,
) {
  const triangles = rec.triangles,
    packed = s.flatBase < 0 ? -1 : s.flatBase + index
  if (wanted) {
    if (s.wantedCount === s.wantedPacked.length)
      s.wantedPacked = fitPacked(s.wantedPacked, s.wantedCount + 1, s.wantedCount)
    s.wanted[s.wantedCount] = rec
    s.wantedPacked[s.wantedCount++] = packed
    s.wantedTriangles += triangles
    const level = rec.level
    if (level !== undefined && level > s.lodLevel) s.lodLevel = level
  }
  if (!drawn) {
    if (wanted) s.complete = false
    return
  }
  if (s.shownCount === s.shownPacked.length)
    s.shownPacked = fitPacked(s.shownPacked, s.shownCount + 1, s.shownCount)
  s.shown[s.shownCount] = rec
  s.shownPacked[s.shownCount++] = packed
  s.shownTriangles += triangles
}

/** Test page `index`: the frustum unless an ancestor placed it entirely inside (`inside`), its
 *  band, then its cone; the emission order is that of the descent. `inside`, `cones` and `boxes`
 *  are constant under a node: the loop passes them instead of rereading them from state at each
 *  cluster.
 *
 *  The cut rule (`./rule.ts`) decides twice: on the cut's residency for what is drawn, and on
 *  full residency for what is requested — the cut every page would draw once loaded. */
export function take<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  index: number,
  inside: boolean,
  cones: boolean,
  boxes: boolean,
) {
  const rec = pages[index]
  // A cluster that an ancestor places entirely inside the frustum reads no box: neither
  // a test nor a presence check when the root declared it. That is the only record read the
  // frustum imposes on a cluster it does not test.
  if (!inside) {
    const min = rec.min,
      max = rec.max
    if (!min || !max) return
    if (clipRecordBox(min, max) === 0) {
      s.frustumRejected++
      return
    }
  } else if (!boxes && (!rec.min || !rec.max)) return
  const held = s.flatHeld,
    ready = !held || held.isReady(index),
    childReady = !held || held.isChildReady(index),
    pixels = framePixels(s, rec, selectionScratch.pixels),
    t = s.pixelError
  const wanted = drawsCluster(true, pixels[1], pixels[0], true, t),
    drawn = drawsCluster(ready, pixels[1], pixels[0], childReady, t),
    // A hole: a root-cover cluster (nothing coarser stands in for it) the rule would draw were it
    // resident. With group links, readiness is closed upward: nothing under it is ready either, and
    // the rule always would. Without them, a finer resident cluster may draw its surface instead.
    uncovered =
      !ready && rec.parentError == null && drawsCluster(true, pixels[1], pixels[0], childReady, t)
  if (!wanted && !drawn && !uncovered) return
  if (cones && rec.cone && coneSkipsPage(rec, s.flatCone, s.flatWorld, s.cam, rec.min!, rec.max!))
    return
  if (uncovered) s.uncoveredTriangles += rec.triangles
  keep(s, rec, index, wanted, drawn)
}
