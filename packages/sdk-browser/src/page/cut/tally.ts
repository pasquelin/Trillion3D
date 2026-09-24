import type { PageRecord, SelectionState } from './state.ts';

/**
 * The slots a page takes in a page budget, named by every record that draws it: the cut charges
 * them once per pass, whether it asks for the page or draws it. A record that names none takes one
 * slot per record drawn.
 */
export interface BudgetShare {
  /** The pass that last charged it. */
  pass: number;
  slots: number;
}

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

/** Charges a record drawn: its page's share, or one slot. */
export function chargeDrawn<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  const share = rec.budgetShare;
  if (share !== undefined) return chargeShare(s, share);
  return ++s.budgetUsed > s.budget;
}

/** Shrinks `shown` to a prefix and its triangle sum with it: same order, same bits as the
 *  sweep this sum replaces. Fallbacks are the only ones that shorten the cut. */
export function truncateShown<T extends PageRecord>(s: SelectionState<T>, to: number) {
  s.shownCount = to;
  let sum = 0;
  if (s.budget === 0) for (let i = 0; i < to; i++) sum += s.shown[i].triangles;
  else {
    // The budget is charged again on what stays: a share only the dropped tail named is freed.
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
  }
  s.shownTriangles = sum;
}
