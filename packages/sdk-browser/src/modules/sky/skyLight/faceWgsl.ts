import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_XY } from '../../../gpu/shader/fullscreenTriangle.ts'
import {
  type AirBindings,
  airProgram,
  AIR_FOG_BINDINGS,
} from '../../../lighting/atmosphere/programs.ts'
import { GROUND_SKY_RADIANCE, groundSkyMarch } from '../../../lighting/atmosphere/captureWgsl.ts'
import { SKY_CAPTURE } from '../../../lighting/atmosphere/layout.ts'
import { fogBlockOf } from '../../../lighting/fog/readWgsl.ts'
import { CAPTURE_MAX_RADIANCE } from './layout.ts'
import { SKY_CUBE_WGSL } from './cubeWgsl.ts'

/**
 * THE PROGRAMS THAT DRAW A FACE OF THE CAPTURED CUBE, three fullscreen passes over one block
 * (`FACE_LAYOUT`, group 1, read at a dynamic offset a face): the block holds the face's number, the
 * capture's position in the scene (metres), the cube's side and its inverse, and the lower
 * hemisphere's colour and coverage (`lower`), with whether it is applied and whether the clouds
 * are.
 *
 * - `skyFaceMain` writes the air's sky along the pixel's direction, no blending: the march that
 *   draws the sky and fills the sky by direction (`groundSkyMarch`), from the capture's height, no
 *   sun disk, held under what the cube's format keeps.
 * - `fogFaceMain` lays the distant height fog over it: the fog seen along an endless ray from the
 *   capture's position (`fogBeyond`; no volume is bound, the capture holds no volumetric fog), its
 *   light added and what is under it multiplied by what the fog lets through.
 * - `composeFaceMain` lays the clouds traced for the face (a texture of the cloud divider's side,
 *   read bilinearly) and the lower hemisphere's colour over the face: below the horizon, the
 *   lower colour replaces the clouds' light by its coverage and the clouds' transmittance is
 *   multiplied by what remains of it; the colour is not scaled by the lighting pre-exposure, which
 *   the sky light's colour would scale back (`skyLightColor`).
 *
 * A pixel's direction is the face's (`faceDirection`), in the cube's frame; the march reads it in
 * the scene's.
 */
export const FACE_LAYOUT = fieldLayout('SkyFaceBlock', [
  ['face', 'vec4u'],
  ['eye', 'vec4f'],
  ['size', 'vec4f'],
  ['lower', 'vec4f'],
] as const)

/** The lanes of `face`: the face's number, whether the lower hemisphere is replaced, whether the
 *  clouds are laid. */
const FACE_BLOCK = `${FACE_LAYOUT.wgsl}
@group(1) @binding(0) var<uniform> face:SkyFaceBlock;
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}
/** The pixel's direction in the cube's frame, and in the scene's. */
fn pixelDirection(pixel:vec4f)->vec3f{
 let uv=pixel.xy*face.size.y*2.0-1.0;
 return normalize(faceDirection(uv,face.face.x));
}`

/** What the sky draw binds of the air: the light buffer and the two tables the march reads. */
export const SKY_FACE_AIR: AirBindings = { air: 'read', transmittance: true, multiScatter: true }
/** What the fog draw binds of the air: the light buffer, which holds the fog's block, and the
 *  fog's resources. */
export const FOG_FACE_AIR: AirBindings = { air: 'read', fog: true }

export const SKY_FACE_PROGRAM = airProgram(
  SKY_FACE_AIR,
  `${FACE_BLOCK}
@fragment fn skyFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let dir=cubeToScene(pixelDirection(pixel));${groundSkyMarch(SKY_CAPTURE.altitudeKm)}
 return vec4f(min(${GROUND_SKY_RADIANCE},vec3f(${CAPTURE_MAX_RADIANCE}.0)),1.0);
}`,
  [SKY_CUBE_WGSL],
)

export const FOG_FACE_PROGRAM = airProgram(
  FOG_FACE_AIR,
  `${FACE_BLOCK}
@fragment fn fogFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let dir=cubeToScene(pixelDirection(pixel));
 return fogBeyond(dir,face.eye.xyz);
}`,
  [SKY_CUBE_WGSL, fogBlockOf(AIR_FOG_BINDINGS)],
)

export const COMPOSE_FACE_CODE = wgslProgram(
  `${FACE_BLOCK}
@group(0) @binding(0) var clouds:texture_2d<f32>;
@group(0) @binding(1) var cloudSampler:sampler;
@fragment fn composeFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let n=pixelDirection(pixel);
 var out=vec4f(0.0,0.0,0.0,1.0);
 if(face.face.z!=0u){out=textureSample(clouds,cloudSampler,pixel.xy*face.size.y);}
 if(n.z<0.0&&face.face.y!=0u){
  let coverage=saturate(face.lower.a);
  out=vec4f(mix(out.rgb,face.lower.rgb,coverage),out.a*(1.0-coverage));
 }
 return out;
}`,
  [SKY_CUBE_WGSL],
)

export const FACE_ENTRIES = {
  sky: 'skyFaceMain',
  fog: 'fogFaceMain',
  compose: 'composeFaceMain',
} as const
