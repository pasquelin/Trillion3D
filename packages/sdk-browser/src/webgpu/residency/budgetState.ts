/**
 * The page budget's verdict, carried from one image to the next: whether the requested cut fits
 * the pool, the coarser threshold it is drawn at when it does not, and what the admission
 * remembers of this view so as not to ask twice for a threshold that overflowed
 * (`../pages/render/gpuCutAdmission.ts`).
 */
export interface WebgpuBudgetState {
  coverageBudgetLimited: boolean;
  /** Screen-error floor the GPU page budget imposes on the cut; 0 when the requested detail fits. */
  budgetPixelError: number;
  /** Finest threshold whose cut overflowed the pool for the current view, `-1` when none did, with
   *  the view revision and the slot count it was seen under: the admission never asks for it again
   *  while both stay. */
  budgetOverflowError: number;
  budgetOverflowView: number;
  budgetOverflowSlots: number;
  /** The verdict just changed: published once by the flush, as `coverage-budget`. */
  coverageBudgetEvent: Record<string, unknown> | undefined;
}

export function createWebgpuBudgetState(): WebgpuBudgetState {
  return {
    coverageBudgetLimited: false,
    budgetPixelError: 0,
    budgetOverflowError: -1,
    budgetOverflowView: -1,
    budgetOverflowSlots: -1,
    coverageBudgetEvent: undefined,
  };
}
