import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { linearToSrgb } from '../../../../../../math/src/wgsl/color.ts'
import { octDecode } from '../../../../../../math/src/wgsl/octahedral.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { lightReadDeps, type LightAtlasFormat } from '../../../../gpu/core/lightAtlasFormat.ts'
import {
  skyLightReadLayoutEntries,
  skyLightReadWgsl,
} from '../../../../modules/sky/skyLight/read.ts'
import { SKY_READ_WGSL } from '../../../atmosphere/skyReadWgsl.ts'
import { BOUNCE_CM_WGSL, tracedCardLightWgsl } from '../../../bounce/tracedHitWgsl.ts'
import { VIEW_RAY_WGSL } from '../../../deferred/worldAtWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../../direct/lightWgsl.ts'
import { heightFogOverWgsl } from '../../../reflections/rayLightWgsl.ts'
import { rayFogLayoutEntries, type RayFogBindings } from '../../../reflections/rayFog.ts'
import { toneReadEntries } from '../../../toneLutRead.ts'
import { surfaceHitCardsLayoutEntries, type SurfaceHitBindings } from '../../hitWgsl.ts'
import { VISUALIZE_MODE, isLayerMode, visualizeOutputOf } from '../../visualizeModes.ts'
import { hitShadeStatement, outputColour } from '../sceneVisualizeWgsl.ts'
import { visualizeTonemapWgsl } from '../visualizeTonemap.ts'
import { HARDWARE_HIT } from './traceWgsl.ts'
import {
  HARDWARE_DISPATCH_X,
  HARDWARE_FLAG,
  HARDWARE_PARAMS,
  HARDWARE_RAYS_AT,
  HARDWARE_RAY_GROUP,
} from './layout.ts'

/** The format of the texture the shading writes, which the blit lays over the display. */
export const HARDWARE_RADIANCE_FORMAT: GPUTextureFormat = 'rgba16float'

/** The bindings of group 0: the parameters, the list of rays, the hits, the radiance written, the lighting's view with the composition's table after it, the sky light's four, the lights, the fog's cube and its sampler, the cards' reads. */
export const HARDWARE_ANSWER_BINDINGS = {
  params: 0,
  rays: 1,
  hits: 2,
  radiance: 3,
  tone: 4,
  sky: { group: 0, cube: 8, sampler: 9, harmonics: 10, params: 11 },
  lights: 12,
  cards: 16,
} as const
const B = HARDWARE_ANSWER_BINDINGS
export const HARDWARE_ANSWER_FOG: RayFogBindings = { cubemap: 13, sampler: 14 }

export const HARDWARE_ANSWER_ENTRY = 'hardwareAnswer'

/** Where the program reads what a hit finds for the scene view's mode `mode`: the cache's tables and the layers the mode reads, and the table from an object to its placement past them. */
export const hardwareAnswerHit = (
  mode: number,
  feedback = false,
  compressed = false,
): SurfaceHitBindings => ({
  group: 0,
  field: 0,
  grid: 0,
  cards: B.cards,
  instances: B.cards + 19,
  visualize: isLayerMode(mode) || mode === VISUALIZE_MODE.surfaceCache ? mode : undefined,
  feedback,
  compressed,
})

/** The layout of group 0. */
export const hardwareAnswerEntries = (
  mode: number,
  light: LightAtlasFormat,
  feedback = false,
  compressed = false,
) => [
  computeUniformEntry(B.params),
  computeBufferEntry(B.rays, 'read-only-storage'),
  computeTextureEntry(B.hits, 'uint'),
  computeStorageTextureEntry(B.radiance, HARDWARE_RADIANCE_FORMAT),
  computeUniformEntry(B.tone),
  ...toneReadEntries(B.tone + 1, GPUShaderStage.COMPUTE),
  ...skyLightReadLayoutEntries(B.sky, GPUShaderStage.COMPUTE),
  ...surfaceHitCardsLayoutEntries(hardwareAnswerHit(mode, feedback, compressed), light),
  computeBufferEntry(B.lights, 'read-only-storage'),
  ...rayFogLayoutEntries(HARDWARE_ANSWER_FOG, true),
]

/**
 * THE LIGHT OF THE LISTED RAYS' HITS (`hardwareAnswer`), a thread a listed ray, the shading of the scene view (`sceneVisualizeWgsl.ts`) for a hit of the scene's triangles in place of one of the distance
 * field's march: the hit the trace wrote at the ray's pixel (`traceWgsl.ts`) is lit by the cards of the placement it met (`tracedCardLight`, `tracedHitWgsl.ts`: the cone of one pixel at the hit for the footprint,
 * `trace.z` centimetres of depth bias, nothing from a hit nearer than `trace.w`), the mode shows what it asks of them (`hitShadeStatement`); a ray that met nothing sees the sky light; the height fog is laid
 * over the light as far as the hit (or `fog.x` metres at least for the sky) and the pixel goes through the composition's table (`outputStatement`), then is written to the radiance texture.
 */
export const hardwareAnswerWgsl = (
  light: LightAtlasFormat,
  mode: number,
  feedback = false,
  compressed = false,
) =>
  wgslProgram(
    `${HARDWARE_PARAMS.wgsl}
@group(0) @binding(${B.params}) var<uniform> scene:HardwareParams;
@group(0) @binding(${B.rays}) var<storage,read> work:array<u32>;
@group(0) @binding(${B.hits}) var hits:texture_2d<u32>;
@group(0) @binding(${B.radiance}) var radiance:texture_storage_2d<${HARDWARE_RADIANCE_FORMAT},write>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
struct VisSurface{radiance:vec3f,face:vec3f,valid:bool,}
@compute @workgroup_size(${HARDWARE_RAY_GROUP},1,1)
fn ${HARDWARE_ANSWER_ENTRY}(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=(groupId.y*${HARDWARE_DISPATCH_X}u+groupId.x)*${HARDWARE_RAY_GROUP}u+lane;
 if(index>=work[0]){return;}
 let packed=work[${HARDWARE_RAYS_AT}u+index];
 let coord=vec2u(packed&0xffffu,packed>>16u);
 let display=vec2f(scene.size.zw);
 let pixel=(vec2f(coord)+vec2f(0.5))/vec2f(scene.size.xy)*display;
 let eye=viewRayStart(pixel,display);
 let d=viewRay(pixel,display);
 // The cone of one pixel: the angle to the ray of its neighbour.
 let spread=length(viewRay(pixel+vec2f(1.0,0.0),display)-d);
 let invPre=max(scF(SC_AT_INV_PRE_EXPOSURE),1e-12);
 let found=textureLoad(hits,vec2i(coord),0);
 var seen=vec3f(0.0);
 var travelled=0.0;
 var escaped=true;
 if((found.y&${HARDWARE_HIT.found}u)!=0u){
  escaped=false;
  let hitCm=bitcast<f32>(found.x)*f32(BOUNCE_CM);
  travelled=hitCm;
  let normal=octDecode(unpack2x16snorm(found.w));
  let lit=tracedCardLight(found.z,(found.y&${HARDWARE_HIT.front}u)!=0u,(found.y&${HARDWARE_HIT.twoSided}u)!=0u,hitCm,eye*f32(BOUNCE_CM)+d*hitCm,normal,spread*hitCm,scene.trace.z,scene.trace.w,(scene.flags.x&${HARDWARE_FLAG.hiRes}u)!=0u,coord);
  let surface=VisSurface(lit.radiance,select(-normal,normal,dot(normal,d)<0.0),lit.valid);
${hitShadeStatement(mode)}
 }
 if(escaped){seen=skyProbeRadiance(d);}
 ${visualizeOutputOf(mode) === 'radiance' ? `if((scene.flags.x&${HARDWARE_FLAG.fog}u)!=0u)` : 'if(false)'}{
  // A ray that met nothing is fogged over the least distance the sky is, so that the longest trace is no part of the fog.
  let metres=select(scene.fog.x,travelled/f32(BOUNCE_CM),!escaped);
  seen=heightFogOver(seen,eye,d*metres);
 }
 textureStore(radiance,coord,vec4f(${outputColour(mode)},1.0));
}`,
    [
      VIEW_RAY_WGSL,
      octDecode,
      linearToSrgb,
      BOUNCE_CM_WGSL,
      DIRECT_LIGHT_WGSL,
      heightFogOverWgsl(HARDWARE_ANSWER_FOG.cubemap, HARDWARE_ANSWER_FOG.sampler),
      visualizeTonemapWgsl(B.tone),
      skyLightReadWgsl(B.sky),
      SKY_READ_WGSL,
      ...lightReadDeps(light),
      tracedCardLightWgsl(hardwareAnswerHit(mode, feedback, compressed), light),
    ],
  )
