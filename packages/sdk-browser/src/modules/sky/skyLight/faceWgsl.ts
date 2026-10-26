import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import {
  type AirBindings,
  airProgram,
  AIR_FOG_BINDINGS,
} from '../../../lighting/atmosphere/programs.ts'
import { GROUND_SKY_RADIANCE, groundSkyMarch } from '../../../lighting/atmosphere/captureWgsl.ts'
import { preExposedWgsl } from '../../../post/exposure/preWgsl.ts'
import { AIR_TO_SCENE, SCENE_TO_PLANET } from '../../../lighting/atmosphere/hazeWgsl.ts'
import { SKY_MAX_RADIANCE } from '../../../lighting/atmosphere/layout.ts'
import type { AirShape } from '../../../lighting/atmosphere/shape.ts'
import { fogBlockOf } from '../../../lighting/fog/readWgsl.ts'
import { SKY_CUBE_WGSL } from './cubeWgsl.ts'

/**
 * THE PROGRAMS THAT DRAW A FACE OF THE CAPTURED CUBE, three fullscreen passes over one block
 * (`FACE_LAYOUT`, group 1, read at a dynamic offset a face): the block holds the face's number, the
 * capture's position in the scene (metres), the cube's side and its inverse, the clouds' side and
 * the pre-exposure the face is written multiplied by (`size`), and the lower hemisphere's colour and
 * coverage (`lower`), with whether it is applied and whether the clouds are.
 *
 * - `skyFaceMain` writes the air's sky along the pixel's direction, no blending: the march that
 *   draws the sky (`groundSkyMarch`), from the capture's place in the planet's frame, no sun disk,
 *   multiplied by the pre-exposure and then held under what the cube's format keeps; each
 *   step of the march reads the shade the clouds cast on the air's lights and the sky occlusion
 *   that dims the first light's multiple scattering (`CloudShadowSet`, the maps of the image, the
 *   stand-in that shades nothing where the scene has no clouds), as the haze's cells do; shadowed
 *   (`skyLightShadowFromOpaque`), it reads the shade of the opaque scene as well.
 * - `fogFaceMain` lays the distant height fog over it: the fog seen along an endless ray from the
 *   capture's position (`fogBeyond`; no volume is bound, the capture holds no volumetric fog), its
 *   light, multiplied by the pre-exposure, added and what is under it multiplied by what the fog
 *   lets through.
 *   The reference reads the depth of the capture in two places, the draw of the sky-material meshes and the
 *   height fog's depth texture, and has a switch for it (on by default); this capture draws no mesh, so its
 *   depth is the cleared far everywhere, which the endless ray of `fogBeyond` is: the switch would change no
 *   pixel, so it is no setting here.
 * - `composeFaceMain` lays the clouds traced for the face (a texture of the cloud divider's side,
 *   read bilinearly) and the lower hemisphere's colour over the face: below the horizon, the
 *   lower colour, multiplied by the pre-exposure, replaces the clouds' light by its coverage and the
 *   clouds' transmittance is multiplied by what remains of it. The clouds are traced multiplied by
 *   the same number (`writeFaceTrace`), so every term of the face is written at one pre-exposure,
 *   which the light's colour divides out (`skyLightColor`).
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
 *  clouds are laid. The fourth lane of `size` is the pre-exposure (`preExposed`). */
const FACE_BLOCK = `${FACE_LAYOUT.wgsl}
@group(1) @binding(0) var<uniform> face:SkyFaceBlock;
/** The pixel's direction in the cube's frame, and in the scene's. */
fn pixelDirection(pixel:vec4f)->vec3f{
 let uv=pixel.xy*face.size.y*2.0-1.0;
 return normalize(faceDirection(uv,face.face.x));
}`

/** The pre-exposure the face's light is written multiplied by: the block's `size.w`. */
const FACE_PRE_EXPOSED = preExposedWgsl('face.size.w')

/** Where the sky is marched from: the light's place in the planet's frame, kilometres, held no
 *  lower than an eye is (`sceneToPlanet`). */
const LIGHT_PLACE = 'sceneToPlanet(face.eye.xyz)'

/** What the sky draw binds of the air: the light buffer and the two tables the march reads, and the
 *  clouds' shade. */
export const SKY_FACE_AIR: AirBindings = {
  air: 'read',
  transmittance: true,
  multiScatter: true,
  cloudShadow: true,
}
/** The same with the virtual shadow maps the air's lights shade the march with (`skyLightShadowFromOpaque`):
 *  the opaque scene shades the sky of the capture as it shades the haze. */
export const SKY_FACE_AIR_SHADOWED: AirBindings = { ...SKY_FACE_AIR, shadow: true }

/** What the fog draw binds of the air: the light buffer, which holds the fog's block, and the
 *  fog's resources. */
export const FOG_FACE_AIR: AirBindings = { air: 'read', fog: true }

export const skyFaceProgram = (shape: AirShape, shadowed = false) =>
  airProgram(
    shadowed ? SKY_FACE_AIR_SHADOWED : SKY_FACE_AIR,
    `${FACE_BLOCK}${AIR_TO_SCENE}${SCENE_TO_PLANET}
@fragment fn skyFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let dir=cubeToScene(pixelDirection(pixel));${groundSkyMarch(LIGHT_PLACE)}
 return vec4f(min(preExposed(${GROUND_SKY_RADIANCE}),vec3f(${SKY_MAX_RADIANCE}.0)),1.0);
}`,
    [SKY_CUBE_WGSL, FACE_PRE_EXPOSED, FULLSCREEN_VERTEX],
    shape,
  )

export const fogFaceProgram = (shape: AirShape) =>
  airProgram(
    FOG_FACE_AIR,
    `${FACE_BLOCK}
@fragment fn fogFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let dir=cubeToScene(pixelDirection(pixel));
 let beyond=fogBeyond(dir,face.eye.xyz);
 return vec4f(preExposed(beyond.rgb),beyond.a);
}`,
    // The capture holds the scene's fog without the local fog volumes: no program of it holds their code.
    [
      SKY_CUBE_WGSL,
      FACE_PRE_EXPOSED,
      FULLSCREEN_VERTEX,
      fogBlockOf({ ...AIR_FOG_BINDINGS, localFog: false }),
    ],
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
  out=vec4f(mix(out.rgb,preExposed(face.lower.rgb),coverage),out.a*(1.0-coverage));
 }
 return out;
}`,
  [SKY_CUBE_WGSL, FACE_PRE_EXPOSED, FULLSCREEN_VERTEX],
)

export const FACE_ENTRIES = {
  sky: 'skyFaceMain',
  fog: 'fogFaceMain',
  compose: 'composeFaceMain',
} as const
