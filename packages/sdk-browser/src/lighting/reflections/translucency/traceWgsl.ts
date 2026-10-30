import { NO_SCENE_MASKS, type SceneMaskPrograms } from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { skyLightReadWgsl } from '../../../modules/sky/skyLight/read.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { sceneMaskedLayoutEntries } from '../../rays/sceneTrace/sceneMaskWgsl.ts'
import { rayFogWgsl } from '../../bounce/screen/rayFogWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { rayFogLayoutEntries } from '../rayFog.ts'
import {
  TRACE_TRACED_FOG,
  TRACE_TRACED_HIT,
  TRACE_TRACED_SCENE,
} from '../../bounce/screen/traceTracedWgsl.ts'
import { tracedHitLightWgsl } from '../../bounce/tracedHitWgsl.ts'
import { surfaceHitCardsLayoutEntries } from '../../surfaceCache/hitWgsl.ts'
import {
  REFLECTION_GROUP,
  REFLECTION_SKY_LIGHT,
  reflectionBindingsWgsl,
  reflectionFrontWgsl,
  reflectionLightViewWgsl,
} from '../viewLayout.ts'
import { TRACED_MATERIAL_WORD_WGSL } from './materialWord.ts'
import { TRACED_MATERIAL_WGSL } from './materialWords.ts'
import { REFLECTION_REACH_WGSL } from '../reach.ts'
import { TRACED_PATH_WGSL } from './pathWgsl.ts'

/** The formats of the textures the trace writes and the denoising reads: the radiance with the path's length in its alpha, the throughput, and the share of the background hidden and visible. */
export const RTT_RADIANCE_FORMAT: GPUTextureFormat = 'rgba16float'
export const RTT_THROUGHPUT_FORMAT: GPUTextureFormat = 'rgba16float'
export const RTT_BACKGROUND_FORMAT: GPUTextureFormat = 'rgba16float'

/**
 * The traced translucency's parameters, one uniform for the trace and the denoising (`stage.ts` writes it): `size` the trace's texels across and down, the pixels a texel stands for and the image's
 * rank; `events` the surfaces a primary and a secondary path pass and the switches (`RTT_FLAG`); `limits` the throughput under which a path ends, the most a pixel brings back and the pre-exposure; `history` the images a history holds, the scale of its clamp, whether the history is valid (one or zero) and the image's rank parity.
 */
export const RTT_PARAMS = fieldLayout('RttParams', [
  ['size', 'vec4u'],
  ['events', 'vec4u'],
  ['limits', 'vec4f'],
  ['history', 'vec4f'],
] as const)

/** The switches in `RttParams.events.z`. */
export const RTT_FLAG = { refraction: 1, sampleReflection: 2, forceOpaque: 4 } as const

/** The bindings of group 0, clear of the cut's tables (1, 6, 7, 9) and the cards (16 on, 25). */
export const RTT_TRACE_BINDINGS = { params: 0, radiance: 2, throughput: 3, background: 4 } as const
const B = RTT_TRACE_BINDINGS

/** The parameters' declaration, as the trace and the denoising declare it. */
export const RTT_PARAMS_DECLARATION = `${RTT_PARAMS.wgsl}
@group(0) @binding(${B.params}) var<uniform> rtt:RttParams;`

/** The entry of the trace. */
export const RTT_TRACE_ENTRY = 'tracedTranslucencyTrace'

/** The share of the sphere of a hit's neighbourhood the cards are read over: the footprint of a ray of a pixel (`scConeTangent`'s side). */
const RTT_CONE_SIDE = 8

/** The layout of group 0: the parameters, the three textures written, the cut's tables, the cards a hit reads, and the lights with the fog's reads that the height fog is laid with. */
export const tracedTranslucencyEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => [
  computeUniformEntry(B.params),
  computeStorageTextureEntry(B.radiance, RTT_RADIANCE_FORMAT),
  computeStorageTextureEntry(B.throughput, RTT_THROUGHPUT_FORMAT),
  computeStorageTextureEntry(B.background, RTT_BACKGROUND_FORMAT),
  ...dagReadLayoutEntries(),
  ...surfaceHitCardsLayoutEntries(TRACE_TRACED_HIT, light),
  computeBufferEntry(TRACE_TRACED_FOG.lights, 'read-only-storage'),
  ...rayFogLayoutEntries(TRACE_TRACED_FOG, true),
]
/** The layout of the scene trace's group: the trace's resources, and the any-hit test's (the corners, the colour atlas of the masks). */
export const tracedTranslucencySceneEntries = () =>
  sceneMaskedLayoutEntries(TRACE_TRACED_SCENE.first)

/** The path's settings as the kernel holds them: written from the parameters at its start, the path's text reads them by these names. */
const SETTINGS_WGSL = wgslBlock(
  'RTT_SETTINGS_WGSL',
  [],
  `var<private> RTT_MAX_PRIMARY:i32;
var<private> RTT_MAX_SECONDARY:i32;
var<private> RTT_THRESHOLD:f32;
var<private> RTT_NEAR_MAX:f32;
var<private> RTT_START_BIAS:f32;
var<private> RTT_START_NORMAL_BIAS:f32;
var<private> RTT_REFRACTION:bool;
var<private> RTT_SAMPLE_REFLECTION_IN_REFLECTIONS:bool;
var<private> rttSeed:u32;
var<private> rttCoord:vec2u;`,
)

/** The random draws of a path: a hash of the pixel and the image's rank, advanced at each draw. */
const RANDOM_WGSL = wgslBlock(
  'RTT_RANDOM_WGSL',
  [],
  `fn rttNext()->u32{
 rttSeed=rttSeed*747796405u+2891336453u;
 let word=((rttSeed>>((rttSeed>>28u)+4u))^rttSeed)*277803737u;
 return (word>>22u)^word;
}
fn rttRandom1()->f32{return f32(rttNext()>>8u)*(1.0/16777216.0);}
fn rttRandom2()->vec2f{let a=rttRandom1();return vec2f(a,rttRandom1());}`,
)

/** The hooks the path calls (`pathWgsl.ts`): the scene's triangles, a hit's surface and light, the sky. */
const HOOKS_WGSL = wgslBlock(
  'RTT_HOOKS_WGSL',
  [],
  `fn rttScene(origin:vec3f,dir:vec3f,tMin:f32,tMax:f32,onlyTranslucent:bool,cullBack:bool)->StHit{
 let flags=ST_MEET_TRANSLUCENT|select(0u,ST_CULL_BACK,cullBack)|select(0u,ST_ONLY_TRANSLUCENT,onlyTranslucent)|select(0u,ST_FORCE_OPAQUE,(rtt.events.z&${RTT_FLAG.forceOpaque}u)!=0u);
 return stTrace(StRay(origin-view.display.yzw,dir,tMin,tMax,flags));
}
fn rttSurface(hit:StHit,dir:vec3f)->RttSurface{
 var s:RttSurface;
 s.geoNormal=select(-hit.normal,hit.normal,dot(hit.normal,dir)<0.0);
 s.normal=s.geoNormal;
 s.material=rttMaterialOf(hit.placement,hit.record);
 return s;
}
fn rttHitLight(hit:StHit,origin:vec3f,dir:vec3f,surf:RttSurface,reflectionAlpha:f32)->vec3f{
 var light=tracedHitLight(hit,origin,dir,${RTT_CONE_SIDE}.0,reflectionView.hardware.w,0.0,rttCoord);
 if(surf.material.blend!=RTT_BLEND_OPAQUE){light+=surf.material.diffuse*skyIrradiance(surf.normal)/PI;}
 return light;
}
fn rttSky(dir:vec3f)->vec3f{return skyRadiance(dir);}`,
)

/** The entry: a thread a texel of the trace, the front layer's pixel it stands for, the ray from the eye to just short of the opaque depth, the path, the results written. */
const ENTRY_WGSL = wgslBlock(
  'RTT_ENTRY_WGSL',
  [],
  `@group(0) @binding(${TRACE_TRACED_FOG.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.radiance}) var rttRadiance:texture_storage_2d<${RTT_RADIANCE_FORMAT},write>;
@group(0) @binding(${B.throughput}) var rttThroughput:texture_storage_2d<${RTT_THROUGHPUT_FORMAT},write>;
@group(0) @binding(${B.background}) var rttBackground:texture_storage_2d<${RTT_BACKGROUND_FORMAT},write>;
@compute @workgroup_size(8,8,1)
fn ${RTT_TRACE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=rtt.size.xy)){return;}
 RTT_MAX_PRIMARY=i32(rtt.events.x);
 RTT_MAX_SECONDARY=i32(rtt.events.y);
 RTT_REFRACTION=(rtt.events.z&${RTT_FLAG.refraction}u)!=0u;
 RTT_SAMPLE_REFLECTION_IN_REFLECTIONS=(rtt.events.z&${RTT_FLAG.sampleReflection}u)!=0u;
 RTT_THRESHOLD=rtt.limits.x;
 RTT_NEAR_MAX=reflectionView.march.w;
 RTT_START_BIAS=reflectionView.hardware.x;
 RTT_START_NORMAL_BIAS=reflectionView.hardware.y;
 // The texel stands for a pixel of its block, a different one each image.
 let block=rtt.size.z;
 var pixel=id.xy*block;
 pixel+=vec2u(rtt.size.w%block,(rtt.size.w/block)%block);
 pixel=min(pixel,vec2u(view.viewport.xy)-vec2u(1u));
 rttCoord=pixel;
 rttSeed=(pixel.x*1973u+pixel.y*9277u+rtt.size.w*26699u)|1u;
 var radiance=vec3f(0.0);
 var throughput=vec3f(1.0);
 var background=vec2f(0.0);
 var distance=0.0;
 let cell=vec2i(pixel);
 let frontZ=reflectionFrontDepth(cell);
 let opaqueZ=hizOpaqueDepth(cell);
 // Only the pixels a transparent surface covers (its depth is nearer than the opaque one) cast a ray.
 if(frontZ!=opaqueZ){
  let centre=vec2f(pixel)+vec2f(0.5);
  let eye=view.display.yzw;
  let front=worldAt(centre,frontZ);
  let opaque=worldAt(centre,opaqueZ);
  let dir=normalize(front-eye);
  let result=rttTracePath(RttRay(eye,dir,0.0,dot(opaque-eye,dir)-0.001));
  radiance=makeFinite3(result.radiance*rtt.limits.z);
  // The height fog between the eye and the front layer, over the light the rays brought back.
  radiance=spRayFogged(radiance,eye,dir,length(front-eye),result.hit);
  let most=max(radiance.x,max(radiance.y,radiance.z));
  if(most>rtt.limits.y){radiance*=rtt.limits.y/most;}
  throughput=makeFinite3(abs(result.throughput));
  background=result.background;
  distance=select(0.0,clamp(result.distance,0.001,65504.0),result.hit);
 }
 textureStore(rttRadiance,id.xy,vec4f(radiance,distance));
 textureStore(rttThroughput,id.xy,vec4f(throughput,0.0));
 textureStore(rttBackground,id.xy,vec4f(background,0.0,0.0));
}`,
)

/**
 * THE TRACED TRANSLUCENCY'S TRACE (`tracedTranslucencyTrace`), a thread a texel of the trace: the front layer's pixel the texel stands for (a block of `size.z` pixels a side, one pixel of it each image) casts a ray from the
 * eye through that pixel to just short of the opaque depth (a thousandth of a metre), and the path (`rttTracePath`, `pathWgsl.ts`) follows it through the scene's triangles — the translucent surfaces
 * met, their reflections and refractions —, over the materials the scene trace's table holds (`materialWords.ts`). The light of a hit is the cards of its placement (`tracedHitLight`, the
 * surface cache's), plus, for a translucent surface that has none, the sky light's irradiance on its diffuse colour; the sky is the sky light's cube. The radiance is multiplied by the pre-exposure, fogged by the height fog up to the front layer (`spRayFogged`) and held to the most a pixel brings back, with the path's length in the alpha
 * (zero where nothing was hit); the throughput and the background the path lets show are written beside. The group 1 is the reflection group (the view, the depth pyramid, the front depth, the sky light), the group 2 the scene trace and its any-hit test (a masked surface is cut by its alpha at the hit, `sceneMaskWgsl.ts`; with the setting that forces every surface opaque, the rays skip the test).
 */
export const tracedTranslucencyProgram = (
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
) =>
  wgslProgram(RTT_PARAMS_DECLARATION, [
    SETTINGS_WGSL,
    RANDOM_WGSL,
    HOOKS_WGSL,
    ENTRY_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
    reflectionFrontWgsl(REFLECTION_GROUP),
    reflectionLightViewWgsl(REFLECTION_GROUP),
    WORLD_AT_WGSL,
    skyLightReadWgsl(REFLECTION_SKY_LIGHT),
    SKY_READ_WGSL,
    PI,
    makeFinite3,
    DIRECT_LIGHT_WGSL,
    rayFogWgsl(TRACE_TRACED_FOG),
    tracedHitLightWgsl(TRACE_TRACED_HIT, TRACE_TRACED_SCENE, light, programs),
    REFLECTION_REACH_WGSL,
    TRACED_PATH_WGSL,
    TRACED_MATERIAL_WORD_WGSL,
    TRACED_MATERIAL_WGSL,
  ])
