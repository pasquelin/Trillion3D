import type { PageRecord, SelectionState } from './state.ts';

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

/** Finest threshold, in pixels, a budget search steps down to: below it the cut is the one the
 *  host asked for. */
export const MIN_BUDGET_PIXEL_ERROR = 0.125;

/** Passes are numbered across calls: a share a previous cut marked is never taken as counted. */
let budgetPasses = 0;

/** Starts a pass of the budget: nothing charged yet but what it holds. */
export function startBudgetPass<T extends PageRecord>(s: SelectionState<T>) {
  s.budgetPass = ++budgetPasses;
  s.budgetUsed = s.budgetHeld;
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
  if (rec.budgetShare === undefined) s.budgetUsed++;
  return s.budgetUsed > s.budget;
}

/** Shrinks `shown` to a prefix and its triangle sum with it: same order, same bits as the
 *  sweep this sum replaces. Fallbacks are the only ones that shorten the cut. The budget is
 *  charged again on what stays, and a pass it leaves past the budget is marked `over`. */
export function truncateShown<T extends PageRecord>(s: SelectionState<T>, to: number) {
  s.shownCount = to;
  let sum = 0;
  if (s.budget === 0) for (let i = 0; i < to; i++) sum += s.shown[i].triangles;
  else {
    // The budget is charged again on what stays: a slot only the dropped tail took is freed.
    startBudgetPass(s);
    for (let i = 0; i < s.wantedCount; i++) {
      const share = s.wanted[i].budgetShare;
      if (share !== undefined) chargeShare(s, share);
    }
    for (let i = 0; i < to; i++) {
      const rec = s.shown[i];
      sum += rec.triangles;
      chargeDrawn(s, rec);
    }
    if (s.budgetUsed > s.budget) s.over = true;
  }
  s.shownTriangles = sum;
}
