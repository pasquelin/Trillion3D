import { saturate } from '../../../math/src/scalar/reals.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
/**
 * The error ramp a diagnostic view paints with, computed here and nowhere else. Pure arithmetic, so
 * a view can read it without loading the boundary that builds host objects.
 */

/** Error is measured in screen pixels; green is exact, yellow approaches the cut threshold, red exceeds it. */
export function screenErrorRatio(error: number, threshold: number) {
  if (!(error > 0)) return 0
  if (!Number.isFinite(error) || !(threshold > 0)) return 1
  return saturate(error / threshold)
}

/** The colours a diagnostic view paints with, as the two resolves read them (the opaque one,
 *  `../visibility/shader/shadeWgsl.ts`, the blended one, `../webgpu/blend/shader.ts`): the flat
 *  green of a page, the wireframe's edge over a triangle's colour, the two levels of detail, and the
 *  error ramp from green (exact) to red (`screenErrorRatio`). */
export const DIAGNOSTIC_PALETTE_WGSL = wgslBlock(
  'DIAGNOSTIC_PALETTE_WGSL',
  [],
  `fn diagnosticFlat()->vec3f{return vec3f(0.204,0.827,0.6);}
fn diagnosticWire(fill:vec3f,edge:f32)->vec3f{return mix(fill,vec3f(0.04,0.05,0.07),edge);}
fn diagnosticLevel(coarse:bool)->vec3f{return select(vec3f(0.04,0.51,0.94),vec3f(0.95,0.42,0.05),coarse);}
fn diagnosticError(ratio:f32)->vec3f{return vec3f(ratio,1.0-ratio,0.12);}`,
)
