import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { hsvToRgb, rgbToHsv } from '../../../../math/src/wgsl/color.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { SHADING_MODEL_STATE_WGSL } from './shadingModelState.ts'

/**
 * THE THIN SUBSURFACE MODEL'S TERM of a light (`subsurfaceTransmission`), toward `L` (unit), `ao` the material's occlusion and `shade` the
 * light's transmission through the shadow (1 unshadowed): what the light gives the surface seen from the side it does not reach, over the
 * physical model's own light.
 * - The in-scattering: the cosine of the light with the direction away from the eye, to the power 12, times 3 at an opacity of 0 down to
 *   0.1 at an opacity of 1: the effect of seeing through the material toward the light.
 * - The back scattering: the wrapped cosine of the normal with the light, `((N·L)/1.5 + 1/3)^1.5 · 5/3` held to its range, mixed by the opacity
 *   with 1 (an opacity of 0 gives no light that depends on the normal), times the occlusion over 2π.
 * - The transmitted colour: the subsurface colour read as the transmittance at a distance (`modelTransmitDistance`, normalised units), turned
 *   into the extinction, then into the transmittance at a distance of one; its hue and saturation are kept and its value is the
 *   subsurface colour's (a round trip through HSV: the hue shifts and the luminance stays). It weighs the transmission where the light is
 *   shadowed, the subsurface colour itself where it is not.
 * The transmitted colour depends on the pixel alone: `setPixelModel` makes it once (`modelTransmitted`) for every light.
 * The in-scattering mixes the back scattering toward 1, and the transmitted colour's mix by the shadow weighs the result.
 */
export const SUBSURFACE_BXDF_WGSL = wgslBlock(
  'SUBSURFACE_BXDF_WGSL',
  [SHADING_MODEL_STATE_WGSL, INVERSE_PI, hsvToRgb, rgbToHsv],
  `
const SUBSURFACE_LEAST:f32=0.000000000001;
fn subsurfaceTransmittedColour(colour:vec3f)->vec3f{
 let extinction=-log(clamp(colour,vec3f(SUBSURFACE_LEAST),vec3f(1.0)))/max(SUBSURFACE_LEAST,modelTransmitDistance);
 let raw=exp(-extinction);
 return hsvToRgb(vec3f(rgbToHsv(raw).xy,rgbToHsv(colour).z));
}
fn subsurfaceTransmission(N:vec3f,V:vec3f,L:vec3f,ao:f32,shade:f32)->vec3f{
 let inScatter=pow(saturate(dot(L,-V)),12.0)*mix(3.0,0.1,modelOpacity);
 let wrapped=pow(saturate(dot(N,L)*(1.0/1.5)+(0.5/1.5)),1.5)*(2.5/1.5);
 let back=ao*mix(1.0,wrapped,modelOpacity)*INVERSE_PI*0.5;
 return mix(back,1.0,inScatter)*mix(modelTransmitted,modelColour,shade);
}`,
)
