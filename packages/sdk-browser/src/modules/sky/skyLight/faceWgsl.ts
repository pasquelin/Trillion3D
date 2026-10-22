import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_XY } from '../../../gpu/shader/fullscreenTriangle.ts'
import {
  type AirBindings,
  airProgram,
  AIR_FOG_BINDINGS,
} from '../../../lighting/atmosphere/programs.ts'
import { GROUND_SKY_RADIANCE, groundSkyMarch } from '../../../lighting/atmosphere/captureWgsl.ts'
import { ATMOSPHERE_SLOT } from '../../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { SKY_CAPTURE } from '../../../lighting/atmosphere/layout.ts'
import type { AirShape } from '../../../lighting/atmosphere/shape.ts'
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
 *   sun disk, held under what the cube's format keeps; shadowed (`skyLightShadowFromOpaque`), each step
 *   of the march reads the shade of the air's lights as the haze's cells do.
 * - `fogFaceMain` lays the distant height fog over it: the fog seen along an endless ray from the
 *   capture's position (`fogBeyond`; no volume is bound, the capture holds no volumetric fog), its
 *   light added and what is under it multiplied by what the fog lets through.
 *   The reference reads the depth of the capture (`skyLightDepthBuffer`) in two places, the draw of the sky-material
 *   meshes and the height fog's depth texture; this capture draws no mesh, so its depth is the cleared far everywhere,
 *   which the endless ray of `fogBeyond` is: the setting changes no pixel and has no reader here.
 * - `composeFaceMain` lays the clouds traced for the face (a texture of the cloud divider's side,
 *   read bilinearly) and the lower hemisphere's colour over the face: below the horizon, the
 *   lower colour replaces the clouds' light by its coverage and the clouds' transmittance is
 *   multiplied by what remains of it. Every term of the face is written at a pre-exposure of 1
 *   (`skyLightColor`).
 *
 * The programs are written for the air's shape (`AirShape`), the quality settings' own.
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

/** The altitude the sky is marched from, kilometres: the light's height over the planet's ground,
 *  no lower than the capture's least (`SKY_CAPTURE.altitudeKm`). */
const LIGHT_ALTITUDE_KM = `max(${SKY_CAPTURE.altitudeKm},(face.eye.y-atmo(${ATMOSPHERE_SLOT.planet}u).w)*0.001)`

/** What the sky draw binds of the air: the light buffer and the two tables the march reads. */
export const SKY_FACE_AIR: AirBindings = { air: 'read', transmittance: true, multiScatter: true }
/** The same with the virtual shadow maps the air's lights shade the march with (`skyLightShadowFromOpaque`):
 *  the opaque scene shades the sky of the capture as it shades the haze. */
export const SKY_FACE_AIR_SHADOWED: AirBindings = { ...SKY_FACE_AIR, shadow: true }

/** The scene's metres of a point of the march (`airToScene`, `airShadowWgsl.ts`): the march begins over
 *  the planet's top at the light's height and its horizontal place is the origin's, which the light's
 *  own place gives back. */
const FACE_TO_SCENE = `
fn airToScene(p:vec3f)->vec3f{
 return vec3f(p.x*1000.0+face.eye.x,(p.y-bottomRadius())*1000.0+atmo(${ATMOSPHERE_SLOT.planet}u).w,p.z*1000.0+face.eye.z);
}`
/** What the fog draw binds of the air: the light buffer, which holds the fog's block, and the
 *  fog's resources. */
export const FOG_FACE_AIR: AirBindings = { air: 'read', fog: true }

export const skyFaceProgram = (shape: AirShape, shadowed = false) =>
  airProgram(
    shadowed ? SKY_FACE_AIR_SHADOWED : SKY_FACE_AIR,
    `${FACE_BLOCK}${shadowed ? FACE_TO_SCENE : ''}
@fragment fn skyFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let dir=cubeToScene(pixelDirection(pixel));${groundSkyMarch(LIGHT_ALTITUDE_KM)}
 return vec4f(min(${GROUND_SKY_RADIANCE},vec3f(${CAPTURE_MAX_RADIANCE}.0)),1.0);
}`,
    [SKY_CUBE_WGSL],
    shape,
  )

export const fogFaceProgram = (shape: AirShape) =>
  airProgram(
    FOG_FACE_AIR,
    `${FACE_BLOCK}
@fragment fn fogFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let dir=cubeToScene(pixelDirection(pixel));
 return fogBeyond(dir,face.eye.xyz);
}`,
    [SKY_CUBE_WGSL, fogBlockOf(AIR_FOG_BINDINGS)],
    shape,
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
