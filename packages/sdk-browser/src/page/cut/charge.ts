import { frameClusterError } from '../selection/frame.ts';
import type { PageRecord, SelectionState } from './state.ts';

/** What a pass charges against its page budget (`budget` in the cut state). */
export interface CutCharge<T> {
  /** What a page asked for costs (`CutPass`); without it, each record drawn takes one place. */
  slotsOf: ((rec: T) => number) | undefined;
  /** What this pass charged, held places included. */
  used: number;
  /** This pass asked for a page whose parent's screen error is finite: a coarser threshold may
   *  still cut it down. Read on the `slotsOf` path only. */
  finer: boolean;
}

export const cutCharge = <T>(): CutCharge<T> => ({ slotsOf: undefined, used: 0, finer: false });

/** A page asked for takes its places whether or not it is drawn: a cut that fits only while its
 *  pages are missing would overflow as they arrive. */
export function chargeWanted<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  const slotsOf = s.slotsOf;
  if (s.budget === 0 || slotsOf === undefined) return;
  if ((s.used += slotsOf(rec)) > s.budget) s.over = true;
  if (
    !s.finer &&
    rec.parentError != null &&
    frameClusterError(s, rec.parentError, rec.parentSphere ?? rec.sphere, 0) < Infinity
  )
    s.finer = true;
}

/** A record drawn takes one place when the cut names no cost (`slotsOf`): past the budget, the
 *  pass is over, whether the descent or a fallback draws it. */
export function chargeDrawn<T extends PageRecord>(s: SelectionState<T>) {
  if (s.budget !== 0 && s.slotsOf === undefined && s.shownCount > s.budget) s.over = true;
}
