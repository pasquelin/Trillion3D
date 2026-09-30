// The default budgets the residency tests weigh against, as the engine computes them on its
// default canvas (`DEFAULT_BUDGET_CANVAS`).
import { DEFAULT_BUDGET_CANVAS, defaultGpuBudget } from './memoryBudget.ts';
import { effectTargetReserve } from './effectReserve.ts';

/** The GPU total by default, on the default canvas. */
export const DEFAULT_GPU_BUDGET = defaultGpuBudget();
/** The effect targets' reserve on the default canvas. */
export const EFFECT_TARGET_BYTES = effectTargetReserve(DEFAULT_BUDGET_CANVAS);
