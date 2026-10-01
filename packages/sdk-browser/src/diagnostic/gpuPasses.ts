import type { GpuPassTimings } from '../../../sdk-core/src/index.ts';
import type {
  GpuPassBlock,
  GpuPassBlockTotals,
  gpuPassStageOf as stageOf,
} from '../gpu/core/passBlocks.ts';
import { families } from '../host/families.ts';

// The public pass mapping (#1353): as a shipping build strips its stat tools, the core holds only
// these three facades, and the pass table they read is the measurement's chunk
// (`../gpu/core/passBlocks.ts`, `../host/families.ts`), fetched on their first call or once debug
// mode turns on. Until it has arrived a pass reads as unknown — stage `geometry`, block `other` —
// and a sample's blocks as unmeasured, `null` (`docs/SDK.md`).

/** The measurement's code once it has arrived; until then, asks for it. */
const code = () => families.measurement.get();

/** Stage of a pass, by its label. Unknown is `geometry`. */
export const gpuPassStageOf = (name: string): ReturnType<typeof stageOf> =>
  code()?.gpuPassStageOf(name) ?? 'geometry';
/** Block of a pass, by its label. Unknown is `other`. */
export const gpuPassBlockOf = (name: string): GpuPassBlock =>
  code()?.gpuPassBlockOf(name) ?? 'other';
/**
 * GPU duration of each block in a sample (`../stage/mapping.ts` says which is which).
 *
 * `null` everywhere for a missing or truncated sample, and `null` for a block whose pass has no
 * usable duration: a partial sum would pass for a measurement. `null` also for a block the frame
 * never ran — a zero would read as "measured at zero". The three blocks sum to the sample's
 * `totalMs` when all three are measured, and are never added to a CPU duration. Until the pass
 * table has arrived, every block is `null`, as for a sample that measured nothing.
 */
export const gpuPassBlockTotals = (sample: GpuPassTimings | null | undefined): GpuPassBlockTotals =>
  code()?.gpuPassBlockTotals(sample) ?? { visibilityMs: null, materialsMs: null, otherMs: null };
