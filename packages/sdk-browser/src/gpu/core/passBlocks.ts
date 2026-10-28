import type { GpuPassTimings } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { GpuPassBlock } from '../../diagnostic/stage/passDeclaration.ts'
import { gpuPassBlockOf, gpuTotalsBy } from '../../diagnostic/stage/mapping.ts'

/** GPU time of a frame in three blocks: visibility, materials, the rest. */
export type GpuPassBlockTotals = {
  /** Time to find what is visible. */
  visibilityMs: number | null
  /** Time to shade materials. */
  materialsMs: number | null
  /** Everything else. */
  otherMs: number | null
}

/**
 * GPU duration of one `block` in a sample: its passes' own shares added, by the rule every group of
 * passes is added by (`gpuTotalsBy`, `../../diagnostic/stage/mapping.ts`, which also says which pass
 * is in which block). `null` for a missing sample, for a block whose pass has no usable
 * duration — a partial sum would pass for a measurement — and for a block the frame never ran — a
 * zero would read as "measured at zero".
 */
export const passBlockMs = (sample: GpuPassTimings | null | undefined, block: GpuPassBlock) =>
  gpuTotalsBy(sample, gpuPassBlockOf).get(block) ?? null

/**
 * GPU duration of each block in a sample (`passBlockMs` says how each is read), in one walk: the
 * three sum to the time the timed passes cover when all three are measured — the sample's `totalMs`
 * only where the device overlaps no pass —, and are never added to a CPU duration.
 */
export function gpuPassBlockTotals(sample: GpuPassTimings | null | undefined): GpuPassBlockTotals {
  const totals = gpuTotalsBy(sample, gpuPassBlockOf)
  return {
    visibilityMs: totals.get('visibility') ?? null,
    materialsMs: totals.get('materials') ?? null,
    otherMs: totals.get('other') ?? null,
  }
}
