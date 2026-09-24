import type { PageRecord, SelectionState } from './state.ts';
import { frameClusterError } from '../selection/frame.ts';

/**
 * The slots a page takes in a page budget, named by every record that draws it: the cut charges
 * them once per pass, where it asks for the page. A record that names none takes one slot per
 * record drawn.
 */
export interface BudgetShare {
  /** The pass that last charged it. */
  pass: number;
  slots: number;
}

/** What a pass of the cut has charged against its page budget. */
export interface BudgetTally {
  /** Page budget beyond which a pass has nothing left to say; `0` when there is none. */
  budget: number;
  /** Slots held before any page is charged, those this pass has charged, and the pass itself. */
  budgetHeld: number;
  budgetUsed: number;
  budgetPass: number;
  /** Of `budgetUsed`, the slots drawn records naming no share took, and their count when the
   *  current root started: a fallback that truncates the root's cut gives them back in O(1). */
  budgetDrawn: number;
  flatStartDrawn: number;
  /** A fallback that goes past the budget fails the pass too (`pageBudgetFrom`'s search); without
   *  it only a page kept by the descent does. */
  budgetStrict: boolean;
  /** This pass asked for a page finer than a root whose parent's screen error is finite: a
   *  coarser threshold may still cut it down. */
  budgetFiner: boolean;
  /** This pass overflowed the budget: its result is discarded, the descent stops there. */
  over: boolean;
}

/** An empty tally: no budget, nothing charged. */
export const budgetTally = (): BudgetTally => ({
  budget: 0,
  budgetHeld: 0,
  budgetUsed: 0,
  budgetPass: 0,
  budgetDrawn: 0,
  flatStartDrawn: 0,
  budgetStrict: false,
  budgetFiner: false,
  over: false,
});

/** Finest threshold, in pixels, a budget search steps down to: below it the cut is the one the
 *  host asked for. */
export const MIN_BUDGET_PIXEL_ERROR = 0.125;

/** Passes are numbered across calls: a share a previous cut marked is never taken as counted. */
let budgetPasses = 0;

/** Starts a pass of the budget: nothing charged yet but what it holds. */
export function startBudgetPass<T extends PageRecord>(s: SelectionState<T>) {
  s.budgetPass = ++budgetPasses;
  s.budgetUsed = s.budgetHeld;
  s.budgetDrawn = 0;
  s.budgetFiner = false;
}

/** Marks a pass that asked for a page a coarser threshold may still cut down: finer than a root,
 *  with a parent whose screen error is finite. A parent that reaches the near plane is refined at
 *  every threshold. */
export function markFiner<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  if (
    !s.budgetFiner &&
    rec.parentError != null &&
    frameClusterError(s, rec.parentError, rec.parentSphere ?? rec.sphere, 0) < Infinity
  )
    s.budgetFiner = true;
}

/** Charges a page's share, once per pass; true when the pass has gone past the budget. */
export function chargeShare<T extends PageRecord>(s: SelectionState<T>, share: BudgetShare) {
  if (share.pass !== s.budgetPass) {
    share.pass = s.budgetPass;
    s.budgetUsed += share.slots;
  }
  return s.budgetUsed > s.budget;
}

/**
 * Charges a record drawn; true when the pass has gone past the budget. A page's share is charged
 * where the cut asks for it: a record drawn in place of a missing page — a resident ancestor, the
 * root cover — charges nothing more, so each place on screen counts once, for the page that will
 * be resident. A record that names no share takes one slot per record drawn.
 */
export function chargeDrawn<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  if (rec.budgetShare === undefined) {
    s.budgetUsed++;
    s.budgetDrawn++;
  }
  return s.budgetUsed > s.budget;
}

/** Charges a record a fallback draws: it fails the pass only on the budget search's path
 *  (`budgetStrict`); elsewhere only a page the descent keeps does, as it always has. */
export function chargeFallback<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  if (chargeDrawn(s, rec) && s.budgetStrict) s.over = true;
}

/** Shrinks `shown` back to where the current root started (`to`), and its triangle sum with it:
 *  same order, same bits as the sweep this sum replaces. Fallbacks are the only ones that shorten
 *  the cut. The slots the dropped records took are given back from the running total, in O(1):
 *  what the root asked for stays charged, since a fallback never shortens `wanted`. */
export function truncateShown<T extends PageRecord>(s: SelectionState<T>, to: number) {
  s.shownCount = to;
  let sum = 0;
  for (let i = 0; i < to; i++) sum += s.shown[i].triangles;
  s.shownTriangles = sum;
  s.budgetUsed -= s.budgetDrawn - s.flatStartDrawn;
  s.budgetDrawn = s.flatStartDrawn;
}
