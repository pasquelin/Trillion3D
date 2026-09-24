import { createPageBudgetLadder, type PageBudgetLadder } from '../../residency/pageBudgetLadder.ts';

/** The WebGPU engine's ladder, and the verdict change its flush publishes. */
export interface WebgpuBudgetState extends PageBudgetLadder {
  /** The verdict just changed: published once by the flush, as `coverage-budget`. */
  coverageBudgetEvent: Record<string, unknown> | undefined;
}

export function createWebgpuBudgetState(): WebgpuBudgetState {
  return { ...createPageBudgetLadder(), coverageBudgetEvent: undefined };
}
