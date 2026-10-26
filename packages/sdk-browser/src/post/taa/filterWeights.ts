/**
 * The current image's weights in the resolve (`resolveWgsl.ts`): `1 − 1.9·x² + 0.9·x⁴` of the
 * squared distance `x²` in footprints, saturated, so zero from one footprint on — a polynomial fit
 * of a Gaussian-like window that needs no exponential and reaches zero exactly. A sample's spatial
 * weight (`taaWindow`) adds the minimal contribution of 0.005 the history update gives it, so
 * every sample of the kernel weighs and a pixel far from every texel still gets an image; the
 * alignment of the nearest texel, the image's weight in the history (`taaAlignment`), adds none.
 * The CPU models
 * run this very text (`filterWeights.fixture.ts`).
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FULL_PRECISION, HALF_PRECISION, type Precision } from './colorSpaceWgsl.ts'

/** The minimal contribution of a sample of the kernel: no weight sum of the 3×3 is ever zero. */
const MINIMAL_CONTRIBUTION = 0.005

const windowText = ({ F, S }: Precision) => `fn taaKernel${S}(d2:${F},minimal:${F})->${F}{
 let x2=saturate(d2);
 return saturate((0.9*x2-1.9)*x2+1.0+minimal);
}
fn taaWindow${S}(d2:${F})->${F}{return taaKernel${S}(d2,${MINIMAL_CONTRIBUTION});}
fn taaAlignment${S}(d2:${F})->${F}{return taaKernel${S}(d2,0.0);}`

const TAA_WINDOW_WGSL = wgslBlock('TAA_WINDOW_WGSL', [], windowText(FULL_PRECISION))
const TAA_WINDOW_HALF_WGSL = wgslBlock(
  'TAA_WINDOW_HALF_WGSL',
  HALF_PRECISION.enable,
  windowText(HALF_PRECISION),
)
/** The window in precision `p`, its names suffixed by `p.S` (`Precision`). */
export const taaWindowWgsl = (p: Precision) =>
  p === HALF_PRECISION ? TAA_WINDOW_HALF_WGSL : TAA_WINDOW_WGSL
