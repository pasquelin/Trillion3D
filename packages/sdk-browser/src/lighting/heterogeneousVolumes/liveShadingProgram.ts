import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { GI_SAMPLE_WGSL } from '../translucencyGi/frameWgsl.ts'
import { fogBlockOf } from '../fog/readWgsl.ts'
import { fogReadLayoutEntries } from '../fog/read.ts'
import { lightStrengthWgsl } from '../direct/lightStrengthWgsl.ts'
import { lightChannelsOf } from '../direct/lightReachWgsl.ts'
import { tileDeclarations } from '../../materials/virtual/wgsl.ts'
import { VOLUME_LAMP_WGSL } from '../direct/lampSeenWgsl.ts'
import { directShadowWgsl } from '../direct/shadowWgsl.ts'
import { VSM_TRACE_KINDS_BOTH } from '../shadows/vsm/trace/traceWgsl.ts'
import { fallbackOf } from '../../materials/graph/program.ts'
import type { CompiledGraph } from '../../materials/graph/compile.ts'
import { VOLUME_OUTPUT_LIMIT } from '../../../../sdk-core/src/contracts/volumeMaterial.ts'
import { BEER_BUILD_WGSL } from './beerShadowMapWgsl.ts'
import { HV_AMBIENT_OCCLUSION_WGSL } from './ambientOcclusionWgsl.ts'
import { HV_VELOCITY_WGSL } from './liveShadingVelocityWgsl.ts'
import { VECTOR_FORMAT } from '../../post/taa/velocityWgsl.ts'
import { VOLUME_HOLDOUT_FORMAT, holdoutAddWgsl } from '../../post/volumeHoldout.ts'
import { HV_COMPOSITE_WGSL, HV_KERNELS_WGSL } from './liveShadingKernelsWgsl.ts'
import { HV_PIXEL_RAY } from './liveShadingWgsl.ts'
import { BEER_DATA_WGSL } from './beerShadowMapWgsl.ts'
import {
  SVT_ADDRESS,
  SVT_MIP,
  SVT_PAGE_TABLE,
  SVT_UNIFORMS,
  SVT_UNPACK,
  SVT_VOXEL,
} from './sparseVolumeWgsl.ts'

/**
 * THE PROGRAMS OF THE LIVE SHADING, assembled: the lighting cache and the march over the volume's
 * material (the graph, compiled by `compileGraph`), the lights of the scene and their virtual
 * shadow maps, the sparse volume's textures; and the composition. Group 0, one table of bindings
 * (`HV_BINDING`) so that the shaders, the layouts and the bind groups agree.
 */
export const HV_BINDING = {
  lights: 0,
  pageTable: 1,
  projectionData: 2,
  shadowUniforms: 3,
  shadowPool: 4,
  shadowView: 5,
  volume: 6,
  view: 7,
  depth: 8,
  cacheOut: 9,
  cacheIn: 10,
  sampler: 11,
  imageIn: 12,
  imageOut: 13,
  svtSlots: 14,
  values: 17,
  atlasPool0: 40,
  atlasPool1: 41,
  atlasPool2: 42,
  atlasPages: 43,
  atlasSampler: 44,
  blueNoise: 24,
  giVolume: 45,
  shadow: 46,
  beerPrevious: 47,
  beerOut: 48,
  velocity: 49,
  taaView: 50,
  ambient: 51,
  holdout: 52,
  existence: 53,
  fogCubemap: 20,
  fogVolume: 21,
  fogSampler: 22,
  fogTiles: 23,
  composeIn: 12,
  holdoutIn: 13,
} as const

/** The most sparse volume textures one volume graph reads. */
export const HV_MAX_SPARSE = 4

/** Where the page table and the two tile atlases of the sparse volume slot `k` bind: past every other binding of the program. */
export const svtBindings = (k: number) => ({
  pageTable: 60 + 3 * k,
  tilesA: 61 + 3 * k,
  tilesB: 62 + 3 * k,
})

/** The sampled textures every program binds whatever the graph: the depth, the lighting cache, the image, the beer map, the blue noise,
 *  the translucency volume, the occlusion, the existence mask, the fog's cubemap and volume. */
const HV_SAMPLED_FIXED = 10

/** The sparse volumes a graph may read on a device that lets a stage sample `limit` textures: three sampled textures each, and three more
 *  for the colour atlas where the graph reads 2D textures. */
export const sparseAllowed = (limit: number, textured: boolean) =>
  Math.min(
    HV_MAX_SPARSE,
    Math.max(Math.floor((limit - HV_SAMPLED_FIXED - (textured ? 3 : 0)) / 3), 0),
  )

/** Where the colour atlas a volume graph's 2D textures are read from binds (`tileDeclarations`). */
const HV_ATLAS = { lanes: [40, 41, 42], pages: 43 }

/** The format of the lighting cache and of the image of the volumes. */
export const HV_FORMAT: GPUTextureFormat = 'rgba16float'

const b = HV_BINDING

/** Where the fog's read binds what it reads (`fogBlockOf`): the cubemap, the volume, the sampler, the lists of the local volumes. */
export const HV_FOG_BINDINGS = {
  group: 0,
  cubemap: b.fogCubemap,
  volume: b.fogVolume,
  sampler: b.fogSampler,
  tiles: b.fogTiles,
} as const

/** The volume's view of the frame: the camera's matrix and numbers, the view's rectangle, the clocks
 *  and the switches (`packView`, `liveShadingFrame.ts`). */
const HV_VIEW = wgslBlock(
  'HV_VIEW',
  [],
  `
struct HvView{
 inverseViewProj:mat4x4f,
 eye:vec4f,
 forward:vec4f,
 depthMap:vec4f,
 rect:vec4u,
 exposure:vec4f,
 clocks:vec4f,
 flags:vec4u,
 svt0:vec4u,
 svt1:vec4u,
 viewProj:mat4x4f,
 giGrid:vec4f,
 giZ:vec4f,
}`,
)

/** The program declares hvView and hvDepth (the opaque depth). */
const HV_PIXEL_RAY_READ = wgslBlock(
  'HV_PIXEL_RAY_READ',
  [HV_PIXEL_RAY],
  `
/** The camera's ray of a view pixel and the opaque depth under it: the view depth of the depth buffer
 *  (its far value converts to a huge depth), the ray's length per unit of it. */
fn hvPixelRay(viewPixel:vec2f)->HvPixelRay{
 let extent=hvView.rect.xy+hvView.rect.zw;
 let at=vec2i(clamp(viewPixel,vec2f(0.0),vec2f(extent)-vec2f(1.0)));
 let z=textureLoad(hvDepth,at,0);
 let ndc=vec2f(2.0*(viewPixel.x+0.5)/f32(extent.x)-1.0,1.0-2.0*(viewPixel.y+0.5)/f32(extent.y));
 let clip=hvView.inverseViewProj*vec4f(ndc,1.0,1.0);
 let near=clip.xyz/clip.w-hvView.eye.xyz;
 let forward=hvView.forward.xyz;
 var ray:HvPixelRay;
 if(hvView.depthMap.z>0.5){
  ray.origin=hvView.eye.xyz+near-dot(near,forward)*forward;
  ray.direction=forward;
  ray.depth=(z-hvView.depthMap.y)/hvView.depthMap.x;
  ray.perDepth=1.0;
 }else{
  let along=near/dot(near,forward);
  ray.origin=hvView.eye.xyz;
  ray.direction=normalize(along);
  ray.depth=hvView.depthMap.y/(z-hvView.depthMap.x+1e-11*hvView.depthMap.y);
  ray.perDepth=length(along);
 }
 return ray;
}
`,
)

const declarations = (sparse: number, textured: boolean, beer: GPUTextureFormat) => `
@group(0) @binding(${b.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${b.volume}) var<uniform> hv:HvVolume;
@group(0) @binding(${b.view}) var<uniform> hvView:HvView;
@group(0) @binding(${b.svtSlots}) var<uniform> svtSlots:SvtSlots;
@group(0) @binding(${b.depth}) var hvDepth:texture_depth_2d;
@group(0) @binding(${b.cacheOut}) var hvCacheOut:texture_storage_3d<${HV_FORMAT},write>;
@group(0) @binding(${b.cacheIn}) var hvCacheIn:texture_3d<f32>;
@group(0) @binding(${b.sampler}) var hvSampler:sampler;
@group(0) @binding(${b.imageIn}) var hvImageIn:texture_2d<f32>;
@group(0) @binding(${b.imageOut}) var hvImageOut:texture_storage_2d<${HV_FORMAT},write>;
@group(0) @binding(${b.values}) var<storage,read> hvValues:array<vec4u>;
@group(0) @binding(${b.giVolume}) var hvGiVolume:texture_3d<f32>;
@group(0) @binding(${b.shadow}) var<uniform> hvShadow:HvShadow;
@group(0) @binding(${b.beerPrevious}) var hvBeerPrevious:texture_2d<f32>;
@group(0) @binding(${b.beerOut}) var hvBeerOut:texture_storage_2d<${beer},write>;
@group(0) @binding(${b.velocity}) var hvVelocity:texture_storage_2d<${VECTOR_FORMAT},write>;
@group(0) @binding(${b.taaView}) var<uniform> hvTaa:TaaView;
@group(0) @binding(${b.ambient}) var hvAmbient:texture_3d<f32>;
@group(0) @binding(${b.existence}) var hvExistence:texture_3d<f32>;
${Array.from({ length: sparse }, (_, k) => {
  const t = svtBindings(k)
  return `@group(0) @binding(${t.pageTable}) var svtPageTable${k}:texture_3d<u32>;
@group(0) @binding(${t.tilesA}) var svtTilesA${k}:texture_3d<f32>;
@group(0) @binding(${t.tilesB}) var svtTilesB${k}:texture_3d<f32>;`
}).join('\n')}
${textured ? `${tileDeclarations(HV_ATLAS, 'color')}\n@group(0) @binding(${b.atlasSampler}) var mapsSampler:sampler;` : ''}
`

/** The slots of the sparse volumes a graph reads, in the uniform: the scene node each holds and its two packed words of uniforms. */
const SVT_SLOTS = wgslBlock(
  'HV_SVT_SLOTS',
  [],
  `struct SvtSlots{nodes:vec4u,words:array<vec4u,${2 * HV_MAX_SPARSE}>,}`,
)

/** The shadow read of a light at a point: one sample of the light's virtual shadow map, as the fog reads it. */
const SHADOW = directShadowWgsl({
  vsm: {
    pageTable: b.pageTable,
    projectionData: b.projectionData,
    uniforms: b.shadowUniforms,
    pool: b.shadowPool,
  },
  trace: { view: b.shadowView, noise: 0 },
  quality: 0,
  localShadows: true,
  kinds: VSM_TRACE_KINDS_BOTH,
})

/** The output `name` of the compiled graph at a context, or its default where the graph wires none. */
const outputOf = (c: CompiledGraph, name: 'baseColor' | 'subsurfaceColor' | 'emissive') => {
  const fn = c.functions[name]
  return fn ? `${fn}(ctx,hvG)` : fallbackOf(name).code
}

/** The volume's graph, and its three outputs at a point (`hvSampleExtinction`, `hvSampleAlbedo`, `hvSampleEmission`). */
const graphHostText = (c: CompiledGraph) => `
var<private> hvG:${c.values};
/** Loads the volume's graph values, once an invocation. */
fn hvInit(){
 for(var i=0u;i<${Math.max(c.slots.vectors.length, 1)}u;i++){hvG.v[i]=bitcast<vec4f>(hvValues[i]);}
 for(var i=0u;i<${c.slots.textureRows}u;i++){hvG.t[i]=hvValues[${Math.max(c.slots.vectors.length, 1)}u+i];}
}
fn hvContext(world:vec3f)->MgContext{
 var ctx:MgContext;
 ctx.world=world;
 ctx.eye=hvView.eye.xyz;
 ctx.origin=(hv.localToWorld*vec4f(0.0,0.0,0.0,1.0)).xyz;
 ctx.time=hvView.clocks.x;
 ctx.realTime=hvView.clocks.y;
 mgNeighbour[0]=ctx;
 mgNeighbour[1]=ctx;
 return ctx;
}
fn hvSampleExtinction(local:vec3f,world:vec3f)->vec3f{
 let ctx=hvContext(world);
 return clamp(${outputOf(c, 'subsurfaceColor')}.xyz,vec3f(0.0),vec3f(${VOLUME_OUTPUT_LIMIT}.0));
}
fn hvSampleAlbedo(local:vec3f,world:vec3f)->vec3f{
 let ctx=hvContext(world);
 return saturate(${outputOf(c, 'baseColor')}.xyz);
}
fn hvSampleEmission(local:vec3f,world:vec3f)->vec3f{
 let ctx=hvContext(world);
 return clamp(${outputOf(c, 'emissive')}.xyz,vec3f(0.0),vec3f(${VOLUME_OUTPUT_LIMIT}.0));
}
`

/** The three reads of the sparse volumes the graph's nodes call (`svtVolumeUvw`, `svtCalculateMip`, `svtSample`), over `sparse` binding sets. */
const sparseHostText = (sparse: number) => `
/** The coordinate of a sample that wires none: the point's place in the volume's local bounds. */
fn svtVolumeUvw(ctx:MgContext)->vec3f{
 let local=(hv.worldToLocal*vec4f(ctx.world,1.0)).xyz;
 return (local-(hv.boundsOrigin.xyz-hv.boundsExtent.xyz))/(2.0*hv.boundsExtent.xyz);
}
fn svtCalculateMip(volume:u32,ddx:vec3f,ddy:vec3f,bias:f32)->f32{
${Array.from({ length: sparse }, (_, k) => ` if(volume==svtSlots.nodes[${k}]){return svtCalculateMipLevel(svtUnpack(svtSlots.words[${2 * k}],svtSlots.words[${2 * k + 1}]),ddx,ddy,bias);}`).join('\n')}
 return 0.0;
}
/** One level of the sparse volume the scene node volume cites, among those the graph reads; any other reads nothing. */
fn svtSample(volume:u32,uvw:vec3f,address:vec3u,level:i32,attributes:u32)->vec4f{
${Array.from(
  { length: sparse },
  (_, k) => ` if(volume==svtSlots.nodes[${k}]){
  let at=svtSamplePageTable(svtPageTable${k},svtUnpack(svtSlots.words[${2 * k}],svtSlots.words[${2 * k + 1}]),uvw,address,level);
  if(attributes==0u){return textureSampleLevel(svtTilesA${k},hvSampler,at,0.0);}
  return textureSampleLevel(svtTilesB${k},hvSampler,at,0.0);
 }`,
).join('\n')}
 return vec4f(0.0);
}
`

/** The switches of the volume's pass and the view's numbers; the holdout is added to only where the program binds one. */
const switchesHostText = (holdout: boolean) => `
/** The switches the volume's pass carries in the last word of its uniform (\`packVolume\`): bit 0 an occlusion texture to read, bit 1 a volume that
 *  holds out, bit 2 the existence mask to read, bit 3 the beer map of the camera to write. */
fn hvHoldsOut()->bool{return (hv.light.w&2u)!=0u;}
fn hvUsesExistence()->bool{return (hv.light.w&4u)!=0u;}
/** Whether the march writes the beer map of the camera (bit 3), which the composition and the translucent layers read. */
fn hvCameraBeer()->bool{return (hv.light.w&8u)!=0u;}
/** Adds the opacity a step of a volume that holds out gained to its pixel of the holdout, where the image carries one; nothing where it does not. */
fn hvHoldoutAdd(pixel:vec2u,delta:f32){
${holdout ? ' holdoutAdd(vec2i(pixel),delta);' : ' return;'}
}
fn hvPreExposure()->f32{return hvView.exposure.x;}
fn hvDownsample()->u32{return hvView.flags.y;}
fn hvViewMin()->vec2u{return hvView.rect.xy;}
fn hvViewSize()->vec2u{return hvView.rect.zw;}
`

/** The fog, the lighting cache, the image and the noise, and the reads of the indirect light, the occlusion and the transmittance toward a light. */
const sceneHostText = `
/** The height fog and the volumetric fog at a point of the ray, as the engine's fog lays them over a point: the analytic fog
 *  along the ray (no haze), then the fog's volume, each where the volume's switch asks (hv.boundsOrigin.w, hv.boundsExtent.w). */
fn hvFog(cameraRelative:vec3f,rayT:f32)->vec4f{
 let eye=hvView.eye.xyz;
 let P=eye+cameraRelative;
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(hv.boundsOrigin.w>0.5){over=fogLaidFar(P,eye,false);}
 if(hv.boundsExtent.w>0.5){over=fogVolumeOver(over,P,eye);}
 return over;
}
fn hvSampleLightingCache(uvw:vec3f)->vec3f{return textureSampleLevel(hvCacheIn,hvSampler,uvw,0.0).rgb;}
fn hvStoreCache(voxel:vec3u,value:vec3f){textureStore(hvCacheOut,vec3i(voxel),vec4f(value,1.0));}
/** The engine's blue noise at the pixel and the frame modulo 8 (\`BlueNoiseScalar(ViewPixelCoord, View.StateFrameIndexMod8)\`). */
fn hvBlueNoise(pixel:vec2u)->f32{return blueNoiseScalar(pixel,hvView.flags.z%8u);}
fn hvLoadLighting(pixel:vec2u)->vec4f{
 if(hvView.flags.x!=0u){return vec4f(0.0,0.0,0.0,1.0);}
 return textureLoad(hvImageIn,vec2i(pixel),0);
}
fn hvStoreLighting(pixel:vec2u,value:vec4f){textureStore(hvImageOut,vec2i(pixel),value);}
/** The light the translucency volume gives a point, its ambient term: the indirect in-scattering a volume takes (the
 *  reference dots the harmonics with the zonal harmonic of an isotropic phase, which leaves the constant band), times the
 *  factor of the setting; none where the image made no volume or the volume asks for none. */
fn hvIndirectInscattering(P:vec3f)->vec3f{
 if(hvView.giGrid.w<0.5||hv.light.y==0u){return vec3f(0.0);}
 let slices=hvView.giGrid.z;
 let light=giSampleVolume(hvGiVolume,hvSampler,giVolumeCoord(hvView.viewProj*vec4f(P,1.0),hvView.giZ,slices),slices);
 return max(light[0],vec3f(0.0))*bitcast<f32>(hv.light.z)*hvAmbientOcclusion(P);
}
/** The occlusion of the volume at P, trilinear over its voxels; one where the volume has none (hv.light.w). */
fn hvAmbientOcclusion(P:vec3f)->f32{
 if((hv.light.w&1u)==0u){return 1.0;}
 let local=(hv.worldToLocal*vec4f(P,1.0)).xyz;
 let uvw=saturate((local-(hv.boundsOrigin.xyz-hv.boundsExtent.xyz))/(2.0*hv.boundsExtent.xyz));
 return textureSampleLevel(hvAmbient,hvSampler,uvw,0.0).r;
}
/** The transmittance of the volume from P toward the one light of the pass (the lighting cache of mode 1): one where the light
 *  does not reach it. */
fn hvTransmittanceToLight(P:vec3f)->vec3f{
 let rank=hv.light.x;
 if(rank>=directLights.count||!lightReaches(rank,P)){return vec3f(1.0);}
 let light=directLights.items[rank];
 var toLight:vec3f;
 if(isSun(light)){toLight=-light.directionCone.xyz*hv.limits.y;}
 else{toLight=light.positionRange.xyz-P;}
 return hvComputeTransmittance(P,toLight,u32(hv.limits.z));
}
/** The light every light gives the point \`P\`: colour, attenuation, the scene's shadow, the volume's own
 *  shadow toward the light. */
`

/** The light every light of the scene gives a point. */
const lightHostText = `
fn hvInscatteringAt(P:vec3f,bias:f32)->vec3f{
 var sum=vec3f(0.0);
 let kinds=u32(hv.resolution.w);
 for(var rank=0u;rank<directLights.count;rank++){
  if(hv.light.x!=4294967295u&&rank!=hv.light.x){continue;}
  if(!lightReaches(rank,P)){continue;}
  let light=directLights.items[rank];
  if(light.params.z<=0.0){continue;}
  // The kinds of light the volume takes, and the lights in the view's lighting channel (the first).
  let kind=select(select(select(2u,4u,isSpot(light)),8u,isRect(light)),1u,isSun(light));
  if((kinds&kind)==0u||(lightChannelsOf(light)&1u)==0u){continue;}
  var radiance=light.colorIntensity.rgb*(lightStrength(light)*light.params.z);
  var toLight:vec3f;
  if(isSun(light)){
   toLight=-light.directionCone.xyz*10000.0;
  }else{
   let seen=volumeLamp(light,P,0.0);
   if(seen.w<=0.0){continue;}
   radiance*=seen.w;
   toLight=light.positionRange.xyz-P;
  }
  if(castsShadow(light)&&light.params.y>=0.0){
   radiance*=shadowFactor(i32(light.params.y),light,P,vec3f(0.0),true);
  }
  sum+=hvShadowedInscattering(P,radiance,toLight,bias,shadowsFog(light));
 }
 // The indirect light once, not once for each light the reference's passes add it with (corrected).
 if(hv.light.y==1u&&(hv.light.x==4294967295u||hv.light.x==0u)){sum+=hvIndirectInscattering(P)*12.566370614359172;}
 return sum;
}
`

/**
 * What the march and the cache pass ask of the host, here (`liveShadingWgsl.ts` lists them): the
 * volume's three outputs at a point (the extinction and the emission held to `VOLUME_OUTPUT_LIMIT`, the
 * albedo to [0, 1]), the lights' in-scattering at a point, the cache and the image, the camera's ray
 * of a pixel, and the three reads of the sparse volume the graph's nodes call. The fog is not
 * applied through the engine's fog (`hvFog`), and the indirect light is none.
 */
const hostWgsl = (c: CompiledGraph, sparse: number, holdout: boolean) =>
  wgslBlock(
    'HV_HOST_WGSL',
    [
      SVT_UNIFORMS,
      SVT_SLOTS,
      HV_PIXEL_RAY_READ,
      SVT_UNPACK,
      SVT_ADDRESS,
      SVT_MIP,
      SVT_VOXEL,
      SVT_PAGE_TABLE,
      VOLUME_LAMP_WGSL,
      lightStrengthWgsl('hvView.exposure.w'),
      lightChannelsOf,
      GI_SAMPLE_WGSL,
    ],
    [
      graphHostText(c),
      sparseHostText(sparse),
      switchesHostText(holdout),
      sceneHostText,
      lightHostText,
    ].join(''),
  )

/** The sparse volume slots of a graph, in the order of its texture words. */
export const sparseSlotsOf = (c: CompiledGraph) =>
  c.slots.textures.filter((slot) => slot.source !== undefined)

/** The program of the lighting cache and the march over the graph compiled c: a binding set for each sparse volume it reads
 *  (at most HV_MAX_SPARSE), the colour atlas where it reads a 2D texture. */
export const liveShadingProgram = (
  c: CompiledGraph,
  beer: GPUTextureFormat = 'rgba16float',
  holdout = false,
) => {
  const sparse = sparseSlotsOf(c).length
  if (sparse > HV_MAX_SPARSE)
    throw new Error(`a heterogeneous volume graph reads at most ${HV_MAX_SPARSE} sparse volumes`)
  return wgslProgram(`${declarations(sparse, c.uses.textures, beer)}\n`, [
    DIRECT_LIGHT_WGSL,
    SHADOW,
    c.wgsl,
    fogBlockOf(HV_FOG_BINDINGS),
    blueNoiseWgsl(0, b.blueNoise),
    HV_VIEW,
    ...(holdout ? [holdoutAddWgsl(0, b.holdout)] : []),
    hostWgsl(c, sparse, holdout),
    HV_VELOCITY_WGSL,
    HV_AMBIENT_OCCLUSION_WGSL,
    HV_KERNELS_WGSL,
    BEER_BUILD_WGSL,
  ] satisfies WgslDecl[])
}

/** The composition: a full-screen triangle whose fragment is the volumes' image upsampled and filtered; the pass
 *  blends it over the lit image (`one`, `src-alpha`: its radiance plus the image times its transmittance). */
export const compositeProgram = () =>
  wgslProgram(
    `@group(0) @binding(${b.view}) var<uniform> hvView:HvView;
@group(0) @binding(${b.sampler}) var hvSampler:sampler;
@group(0) @binding(${b.composeIn}) var hvComposeIn:texture_2d<f32>;
@group(0) @binding(${b.holdoutIn}) var hvHoldoutIn:texture_storage_2d<${VOLUME_HOLDOUT_FORMAT},read>;
@group(0) @binding(${b.depth}) var hvDepth:texture_depth_2d;
@group(0) @binding(${b.beerPrevious}) var hvBeerMap:texture_2d<f32>;
fn hvMapFactor()->u32{return hvView.svt1.z;}
fn hvDownsample()->u32{return hvView.flags.y;}
fn hvViewMin()->vec2u{return hvView.rect.xy;}
fn hvViewSize()->vec2u{return hvView.rect.zw;}
fn hvResolution()->vec2f{return vec2f(f32(hvView.svt1.x),f32(hvView.svt1.y));}
fn hvUpsampleMode()->u32{return hvView.svt0.x;}
fn hvFilterMode()->u32{return hvView.svt0.y;}
fn hvFilterWidth()->u32{return hvView.svt0.z;}
fn hvDownsampled(pixel:vec2u)->vec4f{return textureLoad(hvComposeIn,vec2i(pixel),0);}
fn hvDownsampledAt(uv:vec2f)->vec4f{return textureSampleLevel(hvComposeIn,hvSampler,uv,0.0);}
@vertex fn hvComposeVertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 let corner=vec2f(f32((i<<1u)&2u),f32(i&2u));
 return vec4f(corner*2.0-1.0,0.0,1.0);
}
@fragment fn hvComposeFragment(@builtin(position) at:vec4f)->@location(0) vec4f{
 return hvFiltered(vec2i(at.xy));
}
/** The composition with the translucency (HeterogeneousVolumesComposite.usf:26-35, :209): the transmittance the volumes leave is the beer map of the
 *  camera's at the distance of the opaque surface under the pixel, each of the four texels round it read by the exponential fitted to its two ends
 *  (BeerShadowMap_SampleTransmittance), blended bilinearly. */
@fragment fn hvComposeBeerFragment(@builtin(position) at:vec4f)->@location(0) vec4f{
 let image=hvFiltered(vec2i(at.xy));
 let ray=hvPixelRay(floor(at.xy));
 let z=ray.depth*ray.perDepth;
 let size=vec2i(textureDimensions(hvBeerMap));
 let coord=at.xy/f32(hvMapFactor())-vec2f(0.5);
 let base=vec2i(floor(coord));
 let w=fract(coord);
 let t00=beerInterpolate(textureLoad(hvBeerMap,clamp(base,vec2i(0),size-vec2i(1)),0),z);
 let t10=beerInterpolate(textureLoad(hvBeerMap,clamp(base+vec2i(1,0),vec2i(0),size-vec2i(1)),0),z);
 let t01=beerInterpolate(textureLoad(hvBeerMap,clamp(base+vec2i(0,1),vec2i(0),size-vec2i(1)),0),z);
 let t11=beerInterpolate(textureLoad(hvBeerMap,clamp(base+vec2i(1,1),vec2i(0),size-vec2i(1)),0),z);
 return vec4f(image.rgb,mix(mix(t00,t10,w.x),mix(t01,t11,w.x),w.y));
}
/** The opacity the volumes that hold out left at a pixel, in the alpha: read at the pixel over the whole factor of the downsampling, the
 *  holdout being laid at the volumes' own resolution (the reference reads it over the factor the iterations left, which no longer
 *  matches once the image was brought up by steps: corrected). */
@fragment fn hvHoldoutFragment(@builtin(position) at:vec4f)->@location(0) vec4f{
 return vec4f(0.0,0.0,0.0,textureLoad(hvHoldoutIn,vec2i(at.xy)/vec2i(i32(hvDownsample()))).x);
}
`,
    [HV_VIEW, HV_PIXEL_RAY_READ, BEER_DATA_WGSL, HV_COMPOSITE_WGSL],
  )

/** The layout entries of the composition. */
export const compositeLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(b.view, {}, GPUShaderStage.FRAGMENT),
  computeSamplerEntry(b.sampler, 'filtering', GPUShaderStage.FRAGMENT),
  computeTextureEntry(b.composeIn, 'float', '2d', GPUShaderStage.FRAGMENT),
]

/** The layout of the composition with the translucency: the volumes' image, the opaque depth and the beer map of the camera. */
export const compositeBeerLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  ...compositeLayoutEntries(),
  computeTextureEntry(b.depth, 'depth', '2d', GPUShaderStage.FRAGMENT),
  computeTextureEntry(b.beerPrevious, 'unfilterable-float', '2d', GPUShaderStage.FRAGMENT),
]

/** The layout of the pass that adds the holdout to the image's alpha: the view's words and the holdout, read by load. */
export const holdoutLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(b.view, {}, GPUShaderStage.FRAGMENT),
  computeStorageTextureEntry(
    b.holdoutIn,
    VOLUME_HOLDOUT_FORMAT,
    'read-only',
    '2d',
    GPUShaderStage.FRAGMENT,
  ),
]

/** The layout entries of the lighting cache and march programs over sparse sparse volumes, textured where they read the colour atlas. */
export const liveShadingLayoutEntries = (
  sparse: number,
  textured: boolean,
  beer: GPUTextureFormat,
  holdout = false,
): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(b.lights, 'read-only-storage'),
  computeBufferEntry(b.pageTable, 'read-only-storage'),
  computeBufferEntry(b.projectionData, 'read-only-storage'),
  computeUniformEntry(b.shadowUniforms),
  computeBufferEntry(b.shadowPool, 'read-only-storage'),
  computeUniformEntry(b.shadowView),
  computeUniformEntry(b.volume),
  computeUniformEntry(b.view),
  computeUniformEntry(b.svtSlots),
  computeTextureEntry(b.depth, 'depth'),
  computeStorageTextureEntry(b.cacheOut, HV_FORMAT, 'write-only', '3d'),
  computeTextureEntry(b.cacheIn, 'float', '3d'),
  computeSamplerEntry(b.sampler),
  computeTextureEntry(b.imageIn, 'float'),
  computeStorageTextureEntry(b.imageOut, HV_FORMAT, 'write-only'),
  ...Array.from({ length: sparse }, (_, k) => {
    const t = svtBindings(k)
    return [
      computeTextureEntry(t.pageTable, 'uint', '3d'),
      computeTextureEntry(t.tilesA, 'float', '3d'),
      computeTextureEntry(t.tilesB, 'float', '3d'),
    ]
  }).flat(),
  computeBufferEntry(b.values, 'read-only-storage'),
  computeTextureEntry(b.blueNoise, 'float'),
  computeTextureEntry(b.giVolume, 'float', '3d'),
  computeUniformEntry(b.shadow),
  computeTextureEntry(b.beerPrevious, 'unfilterable-float'),
  computeStorageTextureEntry(b.beerOut, beer, 'write-only'),
  computeStorageTextureEntry(b.velocity, VECTOR_FORMAT, 'write-only'),
  computeUniformEntry(b.taaView),
  computeTextureEntry(b.ambient, 'float', '3d'),
  computeTextureEntry(b.existence, 'float', '3d'),
  ...(holdout ? [computeStorageTextureEntry(b.holdout, VOLUME_HOLDOUT_FORMAT, 'read-write')] : []),
  ...(textured
    ? [
        computeTextureEntry(b.atlasPool0, 'float', '2d-array'),
        computeTextureEntry(b.atlasPool1, 'float', '2d-array'),
        computeTextureEntry(b.atlasPool2, 'float', '2d-array'),
        computeBufferEntry(b.atlasPages, 'read-only-storage'),
        computeSamplerEntry(b.atlasSampler),
      ]
    : []),
  ...fogReadLayoutEntries(HV_FOG_BINDINGS, GPUShaderStage.COMPUTE),
]
