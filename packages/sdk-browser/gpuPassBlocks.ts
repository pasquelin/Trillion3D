import type { GpuPassTimings } from '../sdk-core/index.ts';
import { gpuPassBlockOf, gpuPassStageOf, gpuTotalsBy, type GpuPassBlock } from './stageMapping.ts';

export { gpuPassBlockOf, gpuPassStageOf, type GpuPassBlock };

export type GpuPassBlockTotals = {
  visibilityMs: number | null;
  materialsMs: number | null;
  otherMs: number | null;
};

/**
 * GPU duration of each block in a sample (`stageMapping.ts` says which is which).
 *
 * `null` everywhere for a missing or truncated sample, and `null` for a block whose pass has no
 * usable duration: a partial sum would pass for a measurement. `null` also for a block the frame
 * never ran — a zero would read as "measured at zero". The three blocks sum to the sample's
 * `totalMs` when all three are measured, and are never added to a CPU duration.
 */
export function gpuPassBlockTotals(sample: GpuPassTimings | null | undefined): GpuPassBlockTotals {
  const totals = gpuTotalsBy(sample, gpuPassBlockOf);
  return {
    visibilityMs: totals.get('visibility') ?? null,
    materialsMs: totals.get('materials') ?? null,
    otherMs: totals.get('other') ?? null,
  };
}
