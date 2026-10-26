import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  EXPOSURE_CURVE_MAX_EV,
  EXPOSURE_CURVE_MIN_EV,
  EXPOSURE_CURVE_SAMPLES,
} from '../../../../sdk-core/src/contracts/exposureCurve.ts'
import { EXPOSURE_MIDDLE_GREY } from '../../../../sdk-core/src/contracts/exposureOptions.ts'

/** The table's uniform: its samples packed four to a `vec4f`. */
const EXPOSURE_CURVE_VECTORS = EXPOSURE_CURVE_SAMPLES / 4
const LAST = EXPOSURE_CURVE_SAMPLES - 1

/**
 * The curve's read for the exposure's adapt program: declares the table (`exposureCurveTable`) as
 * the uniform `curve` at `binding` of group 0, and `curveFactor(mean, saturation)`, the factor the
 * exposure's bias is multiplied by for a scene of mean luminance `mean`, the EV100s read from the
 * saturation luminance `saturation` (`exposureSaturationLuminance`). The scene's EV100 is
 * `log2(mean · 0.18⁻¹ / saturation)` (with a saturation of 1, a luminance of 1 is EV100 0), its
 * place in the table runs from sample 0 at the curve's lowest EV100 to the last at its highest,
 * clamped, and the two samples around it are mixed. A mean of 0 or less reads the first sample (the log of 0 is -inf, which the clamp maps
 * there; WGSL leaves that log indeterminate, so the index is selected instead). The mean is the
 * frame's own, before the range holds it; `adapt` multiplies `meter.response.z` by the factor.
 */
export const curveWgsl = (binding: number) =>
  wgslBlock(
    `EXPOSURE_CURVE_${binding}`,
    [],
    `@group(0) @binding(${binding}) var<uniform> curve:array<vec4f,${EXPOSURE_CURVE_VECTORS}>;
fn curveSample(i:u32)->f32{return curve[i/4u][i%4u];}
fn curveFactor(mean:f32,saturation:f32)->f32{
 let ev=log2(mean/${wgslF32(EXPOSURE_MIDDLE_GREY)}/saturation);
 let at=select(clamp((ev-(${wgslF32(EXPOSURE_CURVE_MIN_EV)}))*${wgslF32(LAST / (EXPOSURE_CURVE_MAX_EV - EXPOSURE_CURVE_MIN_EV))},0.0,${wgslF32(LAST)}),0.0,mean<=0.0);
 let below=u32(floor(at));
 let above=min(below+1u,${LAST}u);
 return mix(curveSample(below),curveSample(above),at-floor(at));
}`,
  )
