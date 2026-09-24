/** The per-page half of the cut's descent: a leaf's clusters tested and kept (`visit.ts`). */
import { coneSkipsPage } from '../selection/helpers.ts';
import { frustumClipBox } from '../../../../sdk-core/src/index.ts';
import { boxMissesLightPages } from '../../../../sdk-core/src/scene/light-shadow/pageOverlap.ts';
import { frameSelects } from '../selection/frame.ts';
import { cutSelectsAtZero } from '../selection/projection.ts';
import { drawnUnderForcing } from './logic.ts';
import { chargeDrawn, chargeWanted } from './charge.ts';
import {
  RESIDENT_ALL,
  residentUnder,
  selectionScratch,
  type PageRecord,
  type SelectionState,
} from './state.ts';

/** Frustum test of a page's world box against the selection planes. */
function clipRecordBox(min: readonly number[], max: readonly number[]) {
  return frustumClipBox(selectionScratch.planes, min[0], min[1], min[2], max[0], max[1], max[2]);
}

/** Keep a cluster already chosen: request, level, residency, stamp.
 *  Build requested and drawable cuts separately; a resident fallback never hides a missing request.
 *  `resident` is the cut's residency rule, resolved once: at `RESIDENT_ALL` there is
 *  nothing to read on the record, and the cluster is kept without another question. */
function keep<T extends PageRecord>(
  s: SelectionState<T>,
  rec: T,
  forcing: boolean,
  resident: number,
) {
  const triangles = rec.triangles;
  if (!forcing) {
    s.wanted[s.wantedCount++] = rec;
    s.wantedTriangles += triangles;
    const level = rec.level;
    if (level !== undefined && level > s.lodLevel) s.lodLevel = level;
    chargeWanted(s, rec);
  }
  if (resident !== RESIDENT_ALL && !residentUnder(s, rec, resident)) {
    if (forcing) s.flatShort = true;
    else s.flatMissing = true;
    if (!s.rootFallback) s.complete = false;
    return;
  }
  s.shown[s.shownCount++] = rec;
  s.shownTriangles += triangles;
  // A pass that exceeds the budget is discarded as-is: its only result is "too many pages".
  // Knowing at the first overrun skips the rest of the descent, not a page of the cut we keep.
  chargeDrawn(s);
}

/** Test a cluster, except its cut when an ancestor already settled it (`settled`): the frustum and
 *  the cone stay as they are, and the emission order stays that of the full descent.
 *  `inside`, `forcing`, `exact`, `cones`, `boxes` and `resident` are constant under a node: the
 *  loop passes them instead of rereading them from state at each cluster. */
export function take<T extends PageRecord>(
  s: SelectionState<T>,
  rec: T,
  settled: boolean,
  inside: boolean,
  forcing: boolean,
  exact: boolean,
  cones: boolean,
  boxes: boolean,
  resident: number,
) {
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
  if (
    !settled &&
    !(forcing
      ? drawnUnderForcing(s, rec)
      : exact
        ? cutSelectsAtZero(rec)
        : frameSelects(s, rec, s.pixelError))
  )
    return;
  if (cones && rec.cone && coneSkipsPage(rec, s.flatCone, s.flatWorld, s.cam, rec.min!, rec.max!))
    return;
  keep(s, rec, forcing, resident);
}

export function flatVisible<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  return !!rec.min && !!rec.max && clipRecordBox(rec.min, rec.max) !== 0;
}

export function flatConeKeeps<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  if (!s.flatCones || !rec.cone) return true;
  return !coneSkipsPage(rec, s.flatCone, s.flatWorld, s.cam, rec.min!, rec.max!);
}
