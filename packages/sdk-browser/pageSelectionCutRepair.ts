import { cutSelects, projectedClusterError } from './pageSelectionMath.ts';
import { type PageRecord, type SelectionState } from './pageSelectionCutState.ts';
import { flatConeKeeps, flatVisible } from './pageSelectionCutVisit.ts';

const FLAT_ESCALATION_ROUNDS = 3;

/** The pinned bootstrap cover is the last resort when no resident replacement exists. */
export function rootCoverInto<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  start: number,
) {
  s.shown.length = start;
  let whole = true;
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i];
    if (rec.parentError != null || !flatVisible(s, rec) || !flatConeKeeps(s, rec)) continue;
    if (!s.pageResident(rec)) {
      whole = false;
      continue;
    }
    rec.seen = s.frame;
    s.shown.push(rec);
  }
  return whole;
}

/** Le seuil auquel la réparation avait convergé la fois précédente : d'une image à l'autre la
 *  caméra bouge peu, donc la montée repart de là au lieu de refaire les paliers depuis le seuil
 *  de l'image. */
let seuilConverge = 0;

/** Raise the threshold to a resident ancestor when group structure is unavailable. */
export function repairFlat<T extends PageRecord>(s: SelectionState<T>, pages: T[], start: number) {
  const near = s.camera.near;
  let threshold = seuilConverge > s.pixelError ? seuilConverge : s.pixelError,
    hard = false;
  for (let round = 0; round <= FLAT_ESCALATION_ROUNDS; round++) {
    let raised = false;
    for (let i = 0; i < pages.length; i++) {
      const rec = pages[i];
      if (s.pageResident(rec) || !flatVisible(s, rec)) continue;
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
    if (round === FLAT_ESCALATION_ROUNDS) hard = true;
  }
  seuilConverge = threshold;
  s.shown.length = start;
  if (!hard)
    for (let i = 0; i < pages.length; i++) {
      const rec = pages[i];
      if (
        !flatVisible(s, rec) ||
        !cutSelects(rec, s.flatElements, s.flatStretch, s.flatFocal, near, threshold) ||
        !flatConeKeeps(s, rec)
      )
        continue;
      if (!s.pageResident(rec)) {
        hard = true;
        break;
      }
      rec.seen = s.frame;
      s.shown.push(rec);
    }
  if (!hard) return;
  if (!rootCoverInto(s, pages, start)) s.complete = false;
}
