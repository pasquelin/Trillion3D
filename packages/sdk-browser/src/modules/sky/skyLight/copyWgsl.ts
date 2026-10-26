import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import { HALF_MAX } from '../../../../../math/src/wgsl/constants.ts'
import { SKY_CUBE_WGSL } from './cubeWgsl.ts'

/**
 * THE PROGRAMS OF A SPECIFIED CUBEMAP, which take the host's cube to the captured cube the mips,
 * the filter and the harmonics are made from:
 * - `copyFaceMain` writes a face of the captured cube from the host's cube: the texel's direction
 *   turned about the up axis by the block's angle, the host's cube read there bilinearly at its
 *   top level, the colour below the horizon (the turned direction's third axis negative) mixed to
 *   the lower hemisphere's colour by its coverage when the block says so, the alpha 1, all
 *   multiplied by the block's scale, and held between 0 and the half float's largest value (alpha
 *   to 1), the cube being 16-bit;
 * - `copySceneFaceMain` writes a face of the captured cube from the lit image of the scene drawn
 *   for it (`captureScene.ts`): the image read bilinearly over the square the face fills of it
 *   (`scale.xy`, the share of the target the image takes), turned about its vertical axis — a
 *   cube's faces are laid as seen from outside, a camera sees them from inside —, held between 0 and the half float's
 *   largest value, the colour below the horizon of the face's direction mixed to the lower
 *   hemisphere's as above, the alpha 1.
 * The host's cube was rescaled to fit the half float when it was written (`skyLightCubemapScales`).
 */
export const COPY_LAYOUT = fieldLayout('SkyCopyBlock', [
  ['face', 'vec4u'],
  ['rotation', 'vec4f'],
  ['lower', 'vec4f'],
  ['scale', 'vec4f'],
] as const)

/** The lanes of `face`: the face's number, whether the lower hemisphere is replaced. `rotation`: the angle's sine and cosine, and the
 *  inverse of the cube's side. */
export const COPY_CODE = wgslProgram(
  `${COPY_LAYOUT.wgsl}
@group(0) @binding(0) var source:texture_cube<f32>;
@group(0) @binding(1) var sourceSampler:sampler;
@group(0) @binding(2) var scene:texture_2d<f32>;
@group(0) @binding(3) var sceneSampler:sampler;
@group(1) @binding(0) var<uniform> copy:SkyCopyBlock;
/** The colour below the horizon (the direction's third axis negative) mixed to the lower
 *  hemisphere's by its coverage, when the block says so. */
fn lowerHemisphere(rgb:vec3f,d:vec3f)->vec3f{
 if(d.z<0.0&&copy.face.y!=0u){return mix(rgb,copy.lower.rgb,copy.lower.a);}
 return rgb;
}
@fragment fn copyFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let uv=pixel.xy*copy.rotation.z*2.0-1.0;
 let face=faceDirection(uv,copy.face.x);
 let s=copy.rotation.x;
 let c=copy.rotation.y;
 let d=vec3f(face.x*c-face.y*s,face.x*s+face.y*c,face.z);
 let rgb=lowerHemisphere(textureSampleLevel(source,sourceSampler,d,0.0).rgb,d);
 let out=vec4f(rgb,1.0)*copy.scale;
 return clamp(out,vec4f(0.0),vec4f(HALF_MAX,HALF_MAX,HALF_MAX,1.0));
}
@fragment fn copySceneFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let d=faceDirection(pixel.xy*copy.rotation.z*2.0-1.0,copy.face.x);
 let at=vec2f(1.0-pixel.x*copy.rotation.z,pixel.y*copy.rotation.z)*copy.scale.xy;
 let seen=textureSampleLevel(scene,sceneSampler,at,0.0).rgb;
 let top=vec3f(HALF_MAX);
 return vec4f(lowerHemisphere(clamp(seen,vec3f(0.0),top),d),1.0);
}`,
  [SKY_CUBE_WGSL, FULLSCREEN_VERTEX, HALF_MAX],
)
export const COPY_ENTRY = 'copyFaceMain'
export const COPY_SCENE_ENTRY = 'copySceneFaceMain'
