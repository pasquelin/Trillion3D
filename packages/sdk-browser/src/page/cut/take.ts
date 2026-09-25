/** The per-page half of the cut's descent: a leaf's clusters tested and kept (`visit.ts`). */
import { coneSkipsPage } from '../selection/helpers.ts';
import { frustumClipBox } from '../../../../sdk-core/src/index.ts';
import { boxMissesLightPages } from '../../../../sdk-core/src/scene/light-shadow/pageOverlap.ts';
import { framePixels } from '../selection/frame.ts';
import { pixelsAtZero } from '../selection/projection.ts';
import { drawsCluster } from './rule.ts';
import { selectionScratch, type PageRecord, type SelectionState } from './state.ts';

/** Frustum test of a page's world box against the selection planes. */
function clipRecordBox(min: readonly number[], max: readonly number[]) {
  return frustumClipBox(selectionScratch.planes, min[0], min[1], min[2], max[0], max[1], max[2]);
}

/** Keep a cluster in the requested cut when `wanted`, in the drawn one when `drawn`. A requested
 *  cluster not drawn leaves the cut incomplete: its nearest resident ancestor stands in for it. */
function keep<T extends PageRecord>(s: SelectionState<T>, rec: T, wanted: boolean, drawn: boolean) {
  const triangles = rec.triangles;
  if (wanted) {
    s.wanted[s.wantedCount++] = rec;
    s.wantedTriangles += triangles;
    const level = rec.level;
    if (level !== undefined && level > s.lodLevel) s.lodLevel = level;
  }
  if (!drawn) {
    if (wanted) s.complete = false;
    return;
  }
  s.shown[s.shownCount++] = rec;
  s.shownTriangles += triangles;
}

/** Test page `index`, except its band when an ancestor already settled it (`settled`): the frustum
 *  and the cone stay as they are, and the emission order stays that of the full descent.
 *  `inside`, `exact`, `cones` and `boxes` are constant under a node: the loop passes them instead
 *  of rereading them from state at each cluster.
 *
 *  The cut rule (`./rule.ts`) decides twice: on the cut's residency for what is drawn, and on
 *  full residency for what is requested — the cut every page would draw once loaded. */
export function take<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  index: number,
  settled: boolean,
  inside: boolean,
  exact: boolean,
  cones: boolean,
  boxes: boolean,
) {
  const rec = pages[index];
  // A cluster that an ancestor places entirely inside the frustum no longer reads its box: neither
  // a test nor a presence check when the root declared it. That was the only record read the
  // frustum still imposed on a cluster it does not test.
  if (!inside) {
    const min = rec.min,
      max = rec.max;
    if (!min || !max) return;
    if (clipRecordBox(min, max) === 0) {
      s.frustumRejected++;
      return;
    }
  } else if (!boxes && (!rec.min || !rec.max)) return;
  if (
    s.light &&
    boxMissesLightPages(s.light, rec.min!, rec.max!, s.flatElements, s.cam.perspective)
  ) {
    s.frustumRejected++;
    return;
  }
  const ready = !s.flatReady || s.flatReady[index] === 1;
  // Settled: every cluster under the node meets the threshold and its parent does not.
  let wanted = true,
    drawn = ready;
  if (!settled) {
    const childReady = !s.flatChildReady || s.flatChildReady[index] === 1,
      pixels = selectionScratch.pixels,
      t = s.pixelError;
    if (exact) pixelsAtZero(rec, pixels);
    else framePixels(s, rec, pixels);
    wanted = drawsCluster(true, pixels[1], pixels[0], true, t);
    drawn = drawsCluster(ready, pixels[1], pixels[0], childReady, t);
    if (!wanted && !drawn) return;
  }
  if (cones && rec.cone && coneSkipsPage(rec, s.flatCone, s.flatWorld, s.cam, rec.min!, rec.max!))
    return;
  keep(s, rec, wanted, drawn);
}
