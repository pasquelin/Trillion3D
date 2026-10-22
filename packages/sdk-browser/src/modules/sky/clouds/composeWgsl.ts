import { pixelToNdc, unprojectPoint } from '../../../../../math/src/wgsl/projection.ts'
import { ATMOSPHERE_SLOT } from '../../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_MODE, FOG_SLOT } from '../../../../../sdk-core/src/scene/core/fog.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../../lighting/deferred/shaders.ts'
import { fogBlockOf } from '../../../lighting/fog/read.ts'
import {
  AIR_FOG_BINDINGS,
  airProgram,
  type AirBindings,
} from '../../../lighting/atmosphere/programs.ts'
import type { CloudSetup } from './cloudModes.ts'
import { MIN_MAX_BILATERAL, PLAIN_BILATERAL } from './composeBilateralWgsl.ts'
import {
  BILINEAR_UPSAMPLING,
  JITTER_DEPTH_UPSAMPLING,
  JITTER_UPSAMPLING,
  NEAREST_UPSAMPLING,
} from './composeUpsampleWgsl.ts'
import { BOUNDED_READ_WGSL, BOUNDS_FIELD, DEVICE_DEPTH_FLOOR } from './reconstructLayout.ts'

/** The composition's uniform: the cloud images' texture size, the bounds of their reads
 *  (`writeSafeBounds`, `reconstructLayout.ts`), `distances`: the distance under which a pixel takes no
 *  cloud (kilometres), the distance every depth must pass for the cloud to be read bilinearly,
 *  whether the fog is laid on the cloud here (1) or was in the trace (0), and the frame index
 *  modulo 8; and `scale`: the view's pixels to the images' (the position of a pixel in them is its
 *  own times it, over the images' size) and the images' pixel in the view's. */
export const COMPOSE_VIEW = fieldLayout('ComposeView', [
  ['textureSize', 'vec4f'],
  ['bounds', BOUNDS_FIELD],
  ['distances', 'vec4f'],
  ['scale', 'vec4f'],
] as const)

/** Where the composition binds the cloud images, in group 1 (group 0 is the air's). */
export const COMPOSE_BINDING = {
  view: 0,
  colour: 1,
  secondary: 2,
  depth: 3,
  sceneDepth: 4,
  sampler: 5,
} as const

/** What the composition binds of the air: the buffer, the image's frame and the fog's resources. */
export const COMPOSE_AIR_BINDINGS: AirBindings = { air: 'read', frame: true, fog: true }

const B = COMPOSE_BINDING

/** The fog of the scene, the haze apart — the cloud's own trace lays the haze: the height fog or
 *  the linear one, the volume nearest of all. The trace lays it with the late fog off, the
 *  composition with it on. */
export const CLOUD_FOG_WGSL = wgslBlock(
  'CLOUD_FOG_WGSL',
  [fogBlockOf(AIR_FOG_BINDINGS)],
  `
fn cloudFog(P:vec3f,eye:vec3f)->vec4f{
 let mode=directLights.fog[${FOG_SLOT.color}].w;
 let withSky=directLights.atmosphere[${ATMOSPHERE_SLOT.planet}].x!=0.0;
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(mode>${FOG_MODE.exponential - 0.5}){
  over=fogStack(fogVolumeLookup(P-eye,false),heightFog(P,eye,withSky));
 }else if(mode>${FOG_MODE.none}.5){over=linearFog(P,eye,withSky);}
 return over;
}`,
)

/** What every program declares: the uniform, the cloud images (the secondary one with two
 *  surfaces), the scene's depth and the sampler. */
const declarations = (minMax: boolean) => `
${COMPOSE_VIEW.wgsl}
@group(1) @binding(${B.view}) var<uniform> view:ComposeView;
@group(1) @binding(${B.colour}) var cloudColour:texture_2d<f32>;${
  minMax ? `\n@group(1) @binding(${B.secondary}) var cloudSecondary:texture_2d<f32>;` : ''
}
@group(1) @binding(${B.depth}) var cloudDepth:texture_2d<f32>;
@group(1) @binding(${B.sceneDepth}) var sceneDepth:texture_depth_2d;
@group(1) @binding(${B.sampler}) var linearSampler:sampler;
/** The secondary image's texel; the colour image's where only one surface is traced. */
fn loadSecondary(c:vec2i)->vec4f{return loadBounded(${minMax ? 'cloudSecondary' : 'cloudColour'},view.bounds,c);}
`

/** Where a pixel of the view lies in the cloud images, and the four places a random unit step
 *  shifts it to: the step is the pixel's size in the images, of the aspect the view's, as many
 *  pixels as the images' pixel is of the view's. */
const PLACES = `
fn volumeUv(pixel:vec2f)->vec2f{return view.scale.x*pixel*view.textureSize.zw;}
fn jitters(pixel:vec2f)->array<vec2f,4>{
 let unit=vec2f(1.0,frame.size.x*frame.size.w)*frame.size.zw*view.scale.y;
 let at=volumeUv(pixel);
 let frameMod=i32(view.distances.w);
 var seeds=array<i32,4>(0,8,16,32);
 var places:array<vec2f,4>;
 for(var k=0;k<4;k++){
  let random=vec2f(rand3dPcg16(vec3i(vec2i(pixel),frameMod+seeds[k])).xy)*(1.0/65536.0)*2.0-vec2f(1.0);
  places[k]=at+select(vec2f(0.0),normalize(random),any(random!=vec2f(0.0)))*unit;
 }
 return places;
}
`

/** The fog laid on a cloud sample whose ray is the view pixel \`pixel\`'s, at the cloud's depth
 *  \`depthKm\`: the fog along the ray to that depth; the cloud's luminance through the fog's
 *  transmittance, the fog's light over its coverage. A sample that covers nothing is left as it is. */
const FOG = `
fn fogAtPixel(pixel:vec2f,depthKm:f32,cloud:vec4f)->vec4f{
 let coverage=saturate(1.0-cloud.a);
 if(view.distances.z==0.0||coverage<=0.0){return cloud;}
 let ndc=pixelToNdc(pixel,frame.size.xy);
 let dir=normalize(unprojectPoint(frame.inverseViewProj,vec3f(ndc,0.5))-frame.eye.xyz);
 let fog=cloudFog(frame.eye.xyz+dir*(depthKm*1000.0),frame.eye.xyz);
 return vec4f(cloud.rgb*fog.a+coverage*fog.rgb,cloud.a);
}
/** The same for the sample at texture coordinates \`uv\` of the cloud images, whose pixel in the view
 *  they name. */
fn fogOnCloud(uv:vec2f,depthKm:f32,cloud:vec4f)->vec4f{
 return fogAtPixel(uv*view.textureSize.xy/view.scale.x,depthKm,cloud);
}
/** The same at the cloud's front depth read bilinearly there. */
fn fogFromUv(uv:vec2f,cloud:vec4f)->vec4f{
 if(view.distances.z==0.0){return cloud;}
 return fogOnCloud(uv,sampleBounded(cloudDepth,view.bounds,uv).x,cloud);
}
`

/** The pixel's distance from the eye, from the scene's depth: under the cloud's start distance it
 *  takes no cloud. */
const SCENE = `
 let pixel=vec2i(position.xy);
 let deviceZ=max(DEVICE_DEPTH_FLOOR,textureLoad(sceneDepth,pixel,0));
 let scene=unprojectPoint(frame.inverseViewProj,vec3f(pixelToNdc(position.xy,frame.size.xy),deviceZ));
 let pixelKm=length(frame.eye.xyz-scene)*0.001;
 if(pixelKm<view.distances.x){discard;}`

/** What a setup composes with: the way (an index of `CLOUD_UPSAMPLINGS`) and whether the cloud
 *  images hold two surfaces. */
export type ComposeVariant = Pick<CloudSetup, 'upsampling' | 'minMaxDepth'>

function bodyOf({ upsampling, minMaxDepth }: ComposeVariant) {
  switch (upsampling) {
    case 0:
      return BILINEAR_UPSAMPLING
    case 1:
      return JITTER_UPSAMPLING
    case 2:
      return `${SCENE}${NEAREST_UPSAMPLING}`
    case 3:
      return `${SCENE}${JITTER_DEPTH_UPSAMPLING}`
    default:
      return `${SCENE}${minMaxDepth ? MIN_MAX_BILATERAL : PLAIN_BILATERAL}`
  }
}

const programs = new Map<string, string>()

/**
 * THE CLOUDS COMPOSED OVER THE LIT IMAGE, a full-screen pass drawing the cloud's luminance and
 * transmittance, which the blend lays over the image: the luminance added, the image multiplied by
 * the transmittance (`COMPOSE_TARGET`, `compose.ts`). The way the images are enlarged is the
 * setup's (`CloudSetup.upsampling`): the four are in `composeUpsampleWgsl.ts`, the bilateral one
 * in `composeBilateralWgsl.ts`. A program is made for each way and for the images holding two
 * surfaces or one; each is made once.
 *
 * Where the way reads the scene's depth (all but the first two), per view pixel its distance from
 * the eye, from the scene depth, under the cloud's start distance takes no cloud.
 * The fog lies on a sample at the cloud's front depth (`fogOnCloud`): the ray of the sample's pixel,
 * the fog along it, the haze apart.
 */
export function composeProgram(variant: ComposeVariant) {
  const key = `${variant.upsampling}${variant.minMaxDepth}`
  let code = programs.get(key)
  if (code === undefined) {
    code = airProgram(
      COMPOSE_AIR_BINDINGS,
      `${declarations(variant.minMaxDepth)}${PLACES}${FOG}
@fragment fn composeMain(@builtin(position) position:vec4f)->@location(0) vec4f{
 if(frame.eye.w==0.0){discard;}${bodyOf(variant)}
}
`,
      [
        CLOUD_FOG_WGSL,
        pixelToNdc,
        unprojectPoint,
        rand3dPcg16,
        FULLSCREEN_VERTEX,
        BOUNDED_READ_WGSL,
        DEVICE_DEPTH_FLOOR,
      ],
    ).code
    programs.set(key, code)
  }
  return code
}
