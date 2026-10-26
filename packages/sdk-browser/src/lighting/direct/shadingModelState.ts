import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'

/** The state of a pixel's model: its number, the skin's and the thin subsurface's subsurface colour and opacity (and the distance at which that colour is the light's transmittance, `modelTransmitDistance`, and the transmitted colour the thin subsurface makes of it once, `modelTransmitted`), a subsurface profile's number
 *  (its opacity is the skin's), the hair's scatter and its response to the environment, the eye's iris mask, normal and caustic
 *  normal; and the luminance of the light the subsurface scattering spreads over the pixel, summed by the lights
 *  (`scatterAdd`) and written in the lit image's alpha (`lightOut`). */
export const SHADING_MODEL_STATE_WGSL = wgslBlock(
  'SHADING_MODEL_STATE_WGSL',
  [luminance],
  `var<private> pixelModel:u32;
var<private> modelColour:vec3f;
var<private> modelOpacity:f32;
var<private> modelTransmitDistance:f32;
var<private> modelTransmitted:vec3f;
var<private> modelProfile:u32;
var<private> scatterLuma:f32;
var<private> modelScatter:f32;
var<private> modelEnvironment:vec3f;
var<private> irisMask:f32;
var<private> irisNormal:vec3f;
var<private> irisCaustic:vec3f;
var<private> sphereNoNewton:bool;
var<private> clearCoatBottom:bool;
/** The light of the pixel that the scattering spreads, summed by the lights: its luminance (\`lightOut\` writes it in the alpha). */
fn scatterAdd(light:vec3f){scatterLuma+=luminance(light);}`,
)
