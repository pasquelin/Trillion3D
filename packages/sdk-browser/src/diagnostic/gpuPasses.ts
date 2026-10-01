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
/** GPU time of each block in a sample (`../gpu/core/passBlocks.ts`); `null` everywhere until the
 *  pass table has arrived, as for a sample that measured nothing. */
export const gpuPassBlockTotals = (sample: GpuPassTimings | null | undefined): GpuPassBlockTotals =>
  code()?.gpuPassBlockTotals(sample) ?? { visibilityMs: null, materialsMs: null, otherMs: null };
