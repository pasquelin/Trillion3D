/**
 * THE SAMPLING OF THE LIGHTS: for each pixel of the downsampled view, a few lights drawn among the many that reach it, each a sample to be
 * traced (the lot after) and shaded. One group a tile of the downsampled view, the tile one of the list of its mode (`tileListsWgsl`), a thread
 * a downsampled pixel, which
 * - reads the surface at the full-resolution pixel the downsampled one stands for (jittered by a pattern that cycles with the frame:
 *   four rooks for 2 by 2, a checkerboard for 2 by 1);
 * - walks the lights of the cell its pixel falls in (the directional ones after, if the setting lets them join), drops a local light whose
 *   estimate (`estimateLocalLight`) is under the least a sample may weigh, weighs the others by the luminance of their unshadowed light on the
 *   pixel (the light term every lit pass shares, `declaredLight`, with no shadow read), and offers each to the sampler (`addLightSample`), whose
 *   draws the blue noise stratifies;
 * - guided by the last image: the tile's visible set says whether a light was seen there, and a light that was not has its weight cut
 *   (`sampledLightsHiddenWeight`, or `…OnHistoryMiss` where the pixel has no history) unless its power fell under the least weight since;
 * - writes, for each sample, the light drawn, its weight (the sum of the weights over its own), whether it is guided as visible and, for the ray,
 *   its place on the light (an area light's, from the blue noise), its type (hair, two-sided, transmission) and whether it needs tracing at
 *   all (a light that casts no shadow is complete); a sample that repeats the next one's light is dropped (`sampledLightsMergeRays`).
 * The tiles of the empty mode are cleared by `clearSamplesMain`.
 */
import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { pixelToNdc } from '../../../../math/src/wgsl/projection.ts'
import { SURFACE_PAST_WGSL } from '../bounce/screen/vectorsWgsl.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../materials/surface/pixelModel.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import {
  DEFERRED_BINDINGS,
  DEFERRED_LIGHT_FUNCTION_BINDINGS,
  DEFERRED_LIGHT_PROFILE_BINDINGS,
} from '../deferred/bindings.ts'
import { type ContractKey } from '../deferred/contractCuts.ts'
import { LIGHTS_BINDING_WGSL, keyOfClass } from '../deferred/lightPassWgsl.ts'
import {
  LIT_CHANNELS_WGSL,
  LIT_PIXEL_WGSL,
  SUBSURFACE_BINDING_WGSL,
  litCutOf,
  litPixelStatements,
} from '../deferred/litSurfaceWgsl.ts'
import type { TileClass } from '../deferred/tileClass.ts'
import { LOBES_TARGET_WGSL } from '../direct/lobesWgsl.ts'
import { lightingBase, pixelCellWgsl, type LightingBindings } from '../direct/lightingWgsl.ts'
import { lightTraits } from '../direct/lightReachWgsl.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_GROUP } from './layout.ts'
import {
  NO_LIGHT_INDEX,
  RAY_TYPE,
  addLightSample,
  candidateIndex,
  candidateVisible,
  candidateWeight,
  estimateLocalLight,
  initLightSamplerStratified,
  isLightHidden,
  isLightVisible,
  lightTargetWeight,
  noLightRay,
  noLightSample,
  packLightSample,
  packLightSampleRay,
  unpackTile,
} from './lightSamplerWgsl.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'
import { SAMPLED_TILE_SIZE } from './parameters.ts'

const B = SAMPLED_BINDINGS

/** The entry of the sampling over the tiles of a mode (the mode is the pipeline's constant `TILE_MODE`), and of the clearing of the empty tiles. */
export const SAMPLE_ENTRY = 'sampleMain'
export const CLEAR_ENTRY = 'clearSamplesMain'

/** What the sampling reads of the light functions and the light profiles: no shadow of any kind. */
export const SAMPLING_BINDINGS: LightingBindings = {
  lightFunction: DEFERRED_LIGHT_FUNCTION_BINDINGS,
  lightProfile: DEFERRED_LIGHT_PROFILE_BINDINGS,
}

export const TILES_BINDING_WGSL = wgslBlock(
  'SAMPLING_TILES_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.tiles}) var<storage,read> tileLights:array<u32>;`,
)
const SUN_RANKS_BINDING_WGSL = wgslBlock(
  'SAMPLING_SUN_RANKS_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.sunRanks}) var<storage,read> sunRanks:array<u32>;`,
)

/** The tiles of the downsampled view the sampling and the clearing walk, and the samples they write. */
const SAMPLING_RESOURCES_WGSL = wgslBlock(
  'SAMPLING_RESOURCES_WGSL',
  [SAMPLED_PARAMS_WGSL],
  `override TILE_MODE:u32=0u;
@group(0) @binding(${B.downAllocator}) var<storage,read> downAllocator:array<u32>;
@group(0) @binding(${B.downData}) var<storage,read> downData:array<u32>;
@group(0) @binding(${B.samples}) var samples:texture_storage_2d<r32uint,write>;
@group(0) @binding(${B.rays}) var rays:texture_storage_2d<r32uint,write>;
fn sampleCoordOf(down:vec2u,i:u32)->vec2u{return down*params.samples+vec2u(i%params.samples.x,i/params.samples.x);}
/** What the sample 'i' of a downsampled pixel holds when nothing is drawn or traced. */
fn writeEmpty(down:vec2u){
 for(var i=0u;i<params.count1d;i++){
  let c=vec2i(sampleCoordOf(down,i));
  textureStore(samples,c,vec4u(NO_LIGHT_SAMPLE,0u,0u,0u));
  textureStore(rays,c,vec4u(NO_LIGHT_RAY,0u,0u,0u));
 }
}`,
)

/** Clears the samples of the downsampled pixels of the empty tiles. */
export const clearSamplesWgsl = () =>
  wgslProgram(
    `
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${CLEAR_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 if(group.x>=downAllocator[TILE_MODE]){return;}
 let down=unpackTile(downData[TILE_MODE*params.stride+group.x])*${SAMPLED_GROUP}u+lane.xy;
 if(all(down<params.downView)){writeEmpty(down);}
}`,
    [SAMPLING_RESOURCES_WGSL, unpackTile, noLightSample, noLightRay],
  )

/** The sampler's reads of the guide of the last image, and the placing of the pixel in it. */
const GUIDE_WGSL = wgslBlock(
  'SAMPLING_GUIDE_WGSL',
  [SAMPLED_PARAMS_WGSL],
  `@group(0) @binding(${B.guideHistory}) var<storage,read> guideHistory:array<u32>;
/** Whether the pixel's place in the image before is on screen: R's valid history, which picks the share a hidden light keeps. */
var<private> pixelHistory:bool=false;
fn guideVisibleSet(tile:u32,valid:bool)->vec4u{
 if(!valid){return vec4u(0xFFFFFFFFu);}
 return vec4u(guideHistory[tile*4u],guideHistory[tile*4u+1u],guideHistory[tile*4u+2u],guideHistory[tile*4u+3u]);
}
fn guideHiddenSet(tile:u32)->vec2u{
 return vec2u(guideHistory[params.hiddenAt+tile*2u],guideHistory[params.hiddenAt+tile*2u+1u]);
}
fn guideRatio(rank:u32)->f32{return bitcast<f32>(guideHistory[params.ratiosAt+rank]);}`,
)

/** The jitter of a downsampled pixel's full-resolution pixel: 0 where nothing is downsampled, four rooks for 2 by 2, a checkerboard for 2 by 1;
 *  both cycle with the frame. */
export const jitterWgsl = (declaration: WgslDecl, name = 'params') =>
  wgslBlock(
    `SAMPLING_JITTER_WGSL(${declaration.name}, ${name})`,
    [declaration],
    `fn downsampleJitter(down:vec2u)->vec2u{
 if(${name}.factor.x==1u){return vec2u(0u);}
 if(${name}.factor.y!=1u){
  let cell=down%vec2u(2u);
  let index=(cell.x+cell.y*2u+${name}.frame)%4u;
  return vec2u(select(0u,1u,(index&2u)!=0u),select(1u,0u,(index&1u)!=0u));
 }
 return vec2u((down.y+${name}.frame)%2u,0u);
}`,
  )
export const JITTER_WGSL = jitterWgsl(SAMPLED_PARAMS_WGSL)

/** The surfaces' vectors of the image, read by load. */
const VECTORS_BINDING_WGSL = wgslBlock(
  'SAMPLING_VECTORS_BINDING_WGSL',
  [],
  `@group(0) @binding(${B.vectors}) var sceneVectors:texture_2d<u32>;`,
)

const LUMA = 'vec3f(0.3,0.59,0.11)'

/** The weighing of one light on the pixel, and the offer of it to the sampler. */
const OFFER_WGSL = wgslBlock(
  'SAMPLING_OFFER_WGSL',
  [
    SAMPLED_PARAMS_WGSL,
    GUIDE_WGSL,
    estimateLocalLight,
    lightTargetWeight,
    isLightVisible,
    addLightSample,
  ],
  `/** Offers light 'rank' to the sampler of the pixel: a local light under the least estimate is dropped, the others weighed by the luminance of their
 *  light on the pixel (pre-exposed), a light hidden in the last image cut by the guide. A rectangle light is never dropped by the estimate. */
fn offerLight(s:ptr<function,LightSampler>,rank:u32,albedo:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,shading:LobeSurface,visibleSet:vec4u,radial:bool){
 let light=directLights.items[rank];
 if(radial&&!isRect(light)){
  let toLight=light.positionRange.xyz-P;
  let shares=sharesOf(light);
  let power=dot(light.colorIntensity.rgb,${LUMA})*lightStrength(light)*max(shares.x,shares.y);
  if(estimateLocalLight(dot(toLight,toLight),power,1.0/max(light.positionRange.w,1e-6),light.shape.y,view.preExposure.x)<params.minEstimate){return;}
 }
 var luminance=dot(declaredLight(rank,albedo,metal,rough,N,V,P,1.0,shading),${LUMA})*view.preExposure.x;
 if(thinSurface()){
  // The transmission is weighed by the share assumed before it is traced ('sampledLightsTransmissionSampleWeight'), and not at all for a light that does not transmit.
  let kept=thinSubsurface;
  thinSubsurface=vec3f(0.0);
  let without=dot(declaredLight(rank,albedo,metal,rough,N,V,P,1.0,shading),${LUMA})*view.preExposure.x;
  thinSubsurface=kept;
  luminance=without+select(0.0,params.transmission,transmitsLight(light))*(luminance-without);
 }
 var weight=lightTargetWeight(luminance,params.minWeight);
 if(weight<=0.0){return;}
 var visibleBefore=true;
 if(params.guide!=0u){
  visibleBefore=isLightVisible(visibleSet,rank);
  if(!visibleBefore){visibleBefore=luminance*guideRatio(rank)<params.minWeight;}
 }
 if(!visibleBefore){weight*=select(params.hiddenMissWeight,params.hiddenWeight,pixelHistory);}
 addLightSample(s,weight,rank,visibleBefore,radial,params.count1d,params.dirRatio,params.dirMinWeight);
}`,
)

/** The direction toward a light's centre from `P`: what decides, until the rays are drawn on the light, whether a ray enters a two-sided or
 *  transmitting surface. */
const TOWARD_WGSL = wgslBlock(
  'SAMPLING_TOWARD_WGSL',
  [],
  `fn towardLight(light:DirectLight,P:vec3f)->vec3f{
 return select(normalize(light.positionRange.xyz-P),-light.directionCone.xyz,isSun(light));
}
fn isAreaLight(light:DirectLight)->bool{
 return isRect(light)||light.shape.x>0.001||(!isSun(light)&&tubeHalfLengthOf(light)*2.0>0.01);
}`,
)

/**
 * The sampling for the tiles of the class `tileClass` and the rectangle variant `rect`, under the key `key`'s cuts: the entry `sampleMain`.
 * The key is forced unshadowed and contactless: the weight of a light is that of its light on the pixel, the shadow being what the rays say.
 */

const SAMPLING_PART_1 = `  textureStore(samples,vec2i(coord),vec4u(packLightSample(index,weight,visible,guided,true),0u,0u,0u));
  textureStore(rays,vec2i(coord),vec4u(packLightSampleRay(0.0,uv,rayType,false,completed),0u,0u,0u));
 }
}`

/** The pieces a sampling program is made of, by what the contract's cut keeps. */
function samplingParts(key: ContractKey, lights: ContractKey, cut: ReturnType<typeof litCutOf>) {
  return [
    lightingBase(SAMPLING_BINDINGS, lights, { narrow: key.narrow, environment: false, cut }),
    pixelCellWgsl(),
    LIT_PIXEL_WGSL,
    ...(cut.channels ? [LIT_CHANNELS_WGSL] : []),
    LIGHTS_BINDING_WGSL,
    TILES_BINDING_WGSL,
    SUN_RANKS_BINDING_WGSL,
    blueNoiseWgsl(0, B.blue),
    SAMPLING_RESOURCES_WGSL,
    JITTER_WGSL,
    pixelToNdc,
    SURFACE_PAST_WGSL,
    VECTORS_BINDING_WGSL,
    OFFER_WGSL,
    TOWARD_WGSL,
    lightTraits,
    pixelModelOf,
    unpackTile,
    initLightSamplerStratified,
    candidateIndex,
    candidateVisible,
    candidateWeight,
    isLightHidden,
    packLightSample,
    packLightSampleRay,
    noLightSample,
    noLightRay,
    ...(cut.thin ? [SUBSURFACE_BINDING_WGSL] : []),
    ...(cut.lobes ? [LOBES_TARGET_WGSL] : []),
  ]
}

const SAMPLING_PART_2 = ` let cell=cellSlice(pixelCell(pixel.xy,z));
 // The tile of the last image the pixel stands on, moved by a stochastic offset that stands for a bilinear read.
 // Where the surface stood in the image before: the camera's motion, or the vector the velocity stage drew where it moved by itself.
 let size=vec2f(params.historyTiles*${SAMPLED_TILE_SIZE}u);
 let clipBefore=params.previous*vec4f(P,1.0);
 var past=vec2f(-4.0);
 if(clipBefore.w>0.0){
  let camera=clipBefore.xy/clipBefore.w;
  let word=textureLoad(sceneVectors,vec2i(min(vec2u(screen),textureDimensions(sceneVectors)-vec2u(1u))),0).r;
  past=surfacePast(word,pixelToNdc(vec2f(screen)+vec2f(0.5),vec2f(view.viewport.xy)),camera);
 }
 let onScreen=all(abs(past)<=vec2f(1.0))&&params.guide!=0u;
 // The tile of the image before, moved by a stochastic offset that stands for a bilinear read.
 let offset=(blueNoiseVec2(down,params.frame)-vec2f(0.5))*${SAMPLED_TILE_SIZE}.0;
 let pastPixel=vec2f((past.x*0.5+0.5)*size.x,(0.5-past.y*0.5)*size.y)+offset;
 let tile=min(vec2u(clamp(pastPixel,vec2f(0.0),size-vec2f(1.0)))/${SAMPLED_TILE_SIZE}u,params.historyTiles-vec2u(1u));
 let tileIndex=tile.y*params.historyTiles.x+tile.x;
 pixelHistory=onScreen;
 let visibleSet=guideVisibleSet(tileIndex,onScreen);
 var lightDraw=initLightSamplerStratified(blueNoiseScalar(down,params.frame),params.count1d);
`

const SAMPLING_PART_3 = ` for(var index=0u;index<cell.y;index++){
  let rank=listedLight(cell,index);
  if(!listedDrawn(cell,rank)){continue;}
  if(isSun(directLights.items[rank])){continue;}
  offerLight(&lightDraw,rank,albedo,base.a,normal.a,N,V,P,shading,visibleSet,true);
 }
 if(params.directional!=0u){
  for(var index=1u;index<=sunRanks[0];index++){
   offerLight(&lightDraw,sunRanks[index],albedo,base.a,normal.a,N,V,P,shading,visibleSet,false);
  }
 }
 let hasHistory=onScreen;
 let hiddenSet=guideHiddenSet(tileIndex);
 for(var i=0u;i<params.count1d;i++){
  let drawn=lightDraw.packed[i];
  let index=candidateIndex(drawn);
  let coord=sampleCoordOf(down,i);
  var guided=true;
  if(params.guide!=0u){guided=candidateVisible(drawn);}
  var weight=candidateWeight(drawn);
  var visible=true;
  var uv=vec2f(0.5);
`

/** The sampling's entry: the pixel's lit statements, the lights it draws, and the rays the draws ask (`twoSided` and `transmits` the conditions of the surface's rays). */
function samplingText(front: boolean, statements: string, twoSided: string, transmits: string) {
  return `
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${SAMPLE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 if(group.x>=downAllocator[TILE_MODE]){return;}
 let down=unpackTile(downData[TILE_MODE*params.stride+group.x])*${SAMPLED_GROUP}u+lane.xy;
 if(any(down>=params.downView)){return;}
 let screen=down*params.factor+downsampleJitter(down);
 let pixel=vec4f(vec2f(screen)+vec2f(0.5),0.0,1.0);${statements}
${SAMPLING_PART_2} ${front ? 'var' : 'let'} shading=clothSurface(lobeSurface(albedo,base.a,normal.a,N,V));lobeView(shading);${
    front
      ? '\n // The nearest translucent layer that keeps the specular light alone has no diffuse colour to weigh the lights by.\n if(params.spatialU.w!=0u){shading.diffuse=vec3f(0.0);}'
      : ''
  }
${SAMPLING_PART_3}  var rayType=${RAY_TYPE.default}u;
  var completed=true;
  if(index!=${NO_LIGHT_INDEX}u){
   let light=directLights.items[index];
   let area=params.soft!=0u&&isAreaLight(light);
   if(area){uv=blueNoiseVec2(coord,params.frame);}
   var penumbra=true;
   if(params.guide!=0u&&hasHistory){
    if(candidateVisible(drawn)){penumbra=isLightHidden(hiddenSet,index);}else{penumbra=false;}
   }
   let enters=dot(towardLight(light,P),N)<0.0;
   if(pixelModelOf(surfaceFlag)==${PIXEL_MODEL.hair}u){rayType=${RAY_TYPE.hair}u;}
   else if(${twoSided}){if(enters){rayType=${RAY_TYPE.twoSided}u;}}
   else if(${transmits}&&params.transmission>0.0&&transmitsLight(light)){if(enters){rayType=${RAY_TYPE.transmission}u;}}
   completed=!(castsShadow(light)||(rayType==${RAY_TYPE.hair}u&&params.hair.x>0.0));
   weight=lightDraw.weightSum/weight;
   if(params.merge!=0u&&!(area&&(penumbra||rayType==${RAY_TYPE.transmission}u))&&i+1u<params.count1d){
    if(candidateIndex(lightDraw.packed[i+1u])==index){weight=0.0;visible=false;completed=true;}
   }
  }
${SAMPLING_PART_1}`
}

export function samplingWgsl(key: ContractKey, tileClass: TileClass, rect: boolean, front = false) {
  const lights: ContractKey = {
    ...keyOfClass(key, tileClass, rect),
    unshadowed: true,
    contactless: true,
  }
  const cut = litCutOf(tileClass, lights)
  const statements = litPixelStatements(cut).replace('{discard;}', '{writeEmpty(down);return;}')
  const twoSided = cut.thin ? 'thinSurface()' : 'false'
  const transmits = cut.thin ? `(surfaceFlag&${SUBSURFACE_FLAG}u)!=0u` : 'false'
  return wgslBlock(
    `samplingWgsl(${tileClass}, ${rect}, ${key.lobeless}, ${key.profileless}, ${key.channelless}, ${key.narrow}${front ? ', front layer' : ''})`,
    samplingParts(key, lights, cut),
    samplingText(front, statements, twoSided, transmits),
  )
}
