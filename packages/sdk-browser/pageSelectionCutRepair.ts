import { cutSelects, projectedClusterError } from './pageSelectionMath.ts';
import {
  residentUnder,
  truncateShown,
  type PageRecord,
  type SelectionState,
} from './pageSelectionCutState.ts';
import { ESCALATION_ROUNDS } from './pageSelectionTypes.ts';
import { flatConeKeeps, flatVisible } from './pageSelectionCutVisit.ts';

/** The pinned bootstrap cover is the last resort when no resident replacement exists. */
export function rootCoverInto<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  start: number,
) {
  truncateShown(s, start);
  let whole = true;
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i];
    if (rec.parentError != null || !flatVisible(s, rec) || !flatConeKeeps(s, rec)) continue;
    if (!residentUnder(s, rec, s.residentMode)) {
      whole = false;
      continue;
    }
    s.shown[s.shownCount++] = rec;
    s.shownTriangles += rec.triangles;
  }
  return whole;
}

/** Raise the threshold to a resident ancestor when group structure is unavailable. */
export function repairFlat<T extends PageRecord>(s: SelectionState<T>, pages: T[], start: number) {
  const near = s.cam.near;
  let threshold = s.pixelError,
    hard = false;
  for (let round = 0; round <= ESCALATION_ROUNDS; round++) {
    let raised = false;
    for (let i = 0; i < pages.length; i++) {
      const rec = pages[i];
      if (residentUnder(s, rec, s.residentMode) || !flatVisible(s, rec)) continue;
      if (
        !cutSelects(rec, s.flatElements, s.flatStretch, s.flatFocal, near, threshold) ||
        !flatConeKeeps(s, rec)
      )
        continue;
      const parent = projectedClusterError(
        rec.parentError,
        rec.parentSphere ?? rec.sphere,
        0,
        s.flatElements,
        s.flatStretch,
        s.flatFocal,
        near,
      );
      if (parent > 0 && Number.isFinite(parent)) {
        if (parent > threshold) {
          threshold = parent;
          raised = true;
        }
      } else hard = true;
    }
    if (!raised) break;
    if (round === ESCALATION_ROUNDS) hard = true;
  }
  truncateShown(s, start);
  if (!hard)
    for (let i = 0; i < pages.length; i++) {
      const rec = pages[i];
      if (
        !flatVisible(s, rec) ||
        !cutSelects(rec, s.flatElements, s.flatStretch, s.flatFocal, near, threshold) ||
        !flatConeKeeps(s, rec)
      )
        continue;
      if (!residentUnder(s, rec, s.residentMode)) {
        hard = true;
        break;
      }
      s.shown[s.shownCount++] = rec;
      s.shownTriangles += rec.triangles;
    }
  if (!hard) return;
  if (!rootCoverInto(s, pages, start)) s.complete = false;
}
