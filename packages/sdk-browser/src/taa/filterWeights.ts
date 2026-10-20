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
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/** The minimal contribution of a sample of the kernel: no weight sum of the 3×3 is ever zero. */
const MINIMAL_CONTRIBUTION = 0.005

export const TAA_WINDOW_WGSL = wgslBlock(
  'TAA_WINDOW_WGSL',
  [],
  `fn taaKernel(d2:f32,minimal:f32)->f32{
 let x2=saturate(d2);
 return saturate((0.9*x2-1.9)*x2+1.0+minimal);
}
fn taaWindow(d2:f32)->f32{return taaKernel(d2,${MINIMAL_CONTRIBUTION});}
fn taaAlignment(d2:f32)->f32{return taaKernel(d2,0.0);}`,
)
