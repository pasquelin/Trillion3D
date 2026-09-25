/**
 * The page budget's verdict, carried from one image to the next: whether what the image asks the
 * cache for fits the pool (`../pages/render/gpuCutAdmission.ts`). It never moves the threshold:
 * what does not fit stays out of the cache, and its surface is drawn by its nearest resident
 * ancestor (`../../page/cut/rule.ts`).
 */
export interface WebgpuBudgetState {
  coverageBudgetLimited: boolean;
  /** The verdict just changed: published once by the flush, as `coverage-budget`. */
  coverageBudgetEvent: Record<string, unknown> | undefined;
}

export function createWebgpuBudgetState(): WebgpuBudgetState {
  return { coverageBudgetLimited: false, coverageBudgetEvent: undefined };
}
