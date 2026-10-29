import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { declaredLightWgsl } from '../../direct/lightLoopWgsl.ts'
import { lightStrengthWgsl } from '../../direct/lightStrengthWgsl.ts'
import {
  hasLightFunctionWgsl,
  lightFunctionReadWgsl,
  type LightFunctionBindings,
} from '../../lightFunction/readWgsl.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { lightProfileOfWgsl } from '../../lightProfile/lightProfileWgsl.ts'
import { type LightProfileBindings } from '../../lightProfile/lightProfileText.ts'
import { rectBindingsOf, rectSourceWgsl } from '../../rectLightAtlas/readWgsl.ts'
import {
  CM_PER_M_WGSL,
  lightingCommonWgsl,
  lightingLayersWgsl,
  surfaceTexelWgsl,
  VIEW_EXPOSURE,
} from './commonWgsl.ts'
import { directTexelWgsl, storeDirectWgsl } from './directTileWgsl.ts'
import { lightTileCountsWgsl } from './lightTilesWgsl.ts'
import { tileLightAppendWgsl, TILE_LIGHT_REACH_WGSL } from './tileLightsWgsl.ts'
import { SHADOW_TEXELS, TILE_LIGHT_RANK_BITS } from './layout.ts'
import { LIGHT_CENTRE_FACING_WGSL, shadowMaskBlockOf } from './shadowMaskWgsl.ts'

/**
 * THE STOCHASTIC DIRECT LIGHT OF THE CARDS' TEXELS (`surfaceCacheDirectLightingStochastic`): instead of tracing a shadow for every light of every texel, each
 * texel picks `lp.stochasticSamples` of the lights its tile keeps and only those are traced. Four programs, in this order after the masks (which list no
 * trace then): `stochasticGenerate`, `stochasticCompact`, (the shadow trace of `shadowTraceWgsl.ts`, unchanged, over the traces compacted), `stochasticShade`
 * and, where the result is blended over the images, `stochasticTemporal`.
 *
 * A sample is a `vec4u` in the samples' buffer, `sampleSlot(tile, texel, s)` its place: the light's irradiance without its function, profile and clouds (`diffuse`,
 * the part the mask's factor then multiplies, the bits of three floats) and, in the fourth word, the sample packed (`packSample`): the light's index in the tile's list in 12 bits (`NO_LIGHT`
 * for none), whether it is visible, whether it is completed (it casts no shadow) and its weight as a half float in the high 16 bits. The slot of
 * index `lp.stochasticSamples` holds the sum of the luminance the tile's lights would give the texel, in its first word, the bits of a float.
 *
 * `stochasticGenerate` is a thread a texel: each light of the tile weighs `log2(1 + luminance)` of the irradiance it gives the texel with its profile and the atlas's light
 * function, zero where the light does not face the texel, and the texel keeps the lights a stratified random number (the blue noise of the texel and the image,
 * a sample the share `(noise + s) / samples`) picks as a reservoir does, a light under `lp.stochasticMinWeight` never; a sample's weight is the sum of the weights over the
 * samples and its own weight. `stochasticCompact` appends to the shadow traces' list those of the samples that are not completed and whose mask is not yet settled
 * (their light function and clouds' shade left some of the light), as the masks would have listed them. `stochasticShade` sums, over the samples, weight times irradiance times
 * the factor the sample's mask holds, once the traces settled it. `stochasticTemporal` blends that with the texel's history by the number of images accumulated, the history
 * held to the mean of the 5 × 5 texels round it (inside the page) plus and minus `lp.stochasticClampScale` standard deviations and its luminance to that the lights would give.
 *
 * Bindings of group 0, binding 0 the parameters, 1 the tables, 2 the context, and by program: see `STOCHASTIC_*_BINDINGS`.
 */

const MAX_SAMPLES = 4

const SAMPLE_WGSL = wgslBlock(
  'STOCHASTIC_SAMPLE_WGSL',
  [],
  `const NO_LIGHT:u32=0xfffu;
fn luminanceOf(c:vec3f)->f32{return dot(c,vec3f(0.3,0.59,0.11));}
fn sampleSlot(tile:u32,texel:u32,s:u32)->u32{return (tile*LG_TILE*LG_TILE+texel)*(lp.stochasticSamples+1u)+s;}
fn packSample(light:u32,visible:bool,completed:bool,weight:f32)->u32{
 return (light&NO_LIGHT)|select(0u,0x8000u,visible)|select(0u,0x4000u,completed)|((pack2x16float(vec2f(weight,0.0))&0xffffu)<<16u);
}
fn sampleLight(packed:u32)->u32{return packed&NO_LIGHT;}
fn sampleVisible(packed:u32)->bool{return (packed&0x8000u)!=0u;}
fn sampleCompleted(packed:u32)->bool{return (packed&0x4000u)!=0u;}
fn sampleWeight(packed:u32)->f32{return unpack2x16float(packed>>16u).x;}`,
)

// ---------------------------------------------------------------------------------------------------------------------------- generate

export const STOCHASTIC_GENERATE_BINDINGS = {
  tables: 1,
  context: 2,
  counts: 3,
  depth: 4,
  normal: 5,
  culled: 6,
  cardTileOffsets: 7,
  lights: 8,
  standalone: 9,
  samples: 10,
  lightFunction: 11,
  lightProfileAtlas: 12,
  lightProfileSampler: 13,
  noise: 14,
  rectAtlas: 15,
  rectAtlasSampler: 16,
} as const
const G = STOCHASTIC_GENERATE_BINDINGS

const STOCHASTIC_GENERATE_LIGHT_FUNCTION: LightFunctionBindings = {
  group: 0,
  atlas: G.lightFunction,
  eye: 'lp.eye.xyz',
}
export const STOCHASTIC_GENERATE_LIGHT_PROFILE: LightProfileBindings = {
  group: 0,
  atlas: G.lightProfileAtlas,
  sampler: G.lightProfileSampler,
  rectAtlas: G.rectAtlas,
  rectSampler: G.rectAtlasSampler,
}

export const STOCHASTIC_GENERATE_ENTRY = 'stochasticGenerate'

/** The words of the masks of the lights a tile's workgroup keeps: a bit a light rank. */
const LIGHT_MASK_WORDS = 2 ** TILE_LIGHT_RANK_BITS / 32

/** The most lights the texels of a tile pick, each of its texels one a sample: the room of the tile's list of picks, so that no pick is left out. */
const MAX_TILE_PICKS = SHADOW_TEXELS * MAX_SAMPLES

/** The generation of the samples and of the light tiles of the lights they pick. */
export const STOCHASTIC_GENERATE_WGSL = wgslProgram(
  `${wgslConsts({ LIGHT_MASK_WORDS })}
@group(0) @binding(${G.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${G.samples}) var<storage,read_write> sampleData:array<vec4u>;
var<workgroup> candidateMask:array<atomic<u32>,LIGHT_MASK_WORDS>;
var<workgroup> pickedMask:array<atomic<u32>,LIGHT_MASK_WORDS>;
var<workgroup> pickedCount:u32;
const NO_RANK:u32=0xffffffffu;
struct LightTarget{pdf:vec3f,diffuse:vec3f,weight:f32}
/** What light \`rank\` gives the texel: its irradiance times its factor on the indirect lighting (\`diffuse\`), and that with its profile and the atlas's function (\`pdf\`),
 *  weighed by \`log2(1+luminance)\`; nothing where it gives none or does not face the texel. */
fn lightTarget(rank:u32,standalone:bool,texel:SurfaceTexel)->LightTarget{
 var t=LightTarget(vec3f(0.0),vec3f(0.0),0.0);
 let light=directLights.items[rank];
 let P=texel.position/CM_PER_M;
 let bare=declaredBareIrradiance(rank,P,texel.normal,0.0)*light.contactGi.w;
 if(!any(bare>vec3f(0.0))){return t;}
 if(!facesLightCentre(rank,light,P,texel.normal,standalone)){return t;}
 var pdf=bare*lightProfileOf(light,P);
 if(hasLightFunction(light)&&!standalone){
  let f=lightFunctionOf(light,P);
  pdf*=(f.x+f.y+f.z)/3.0;
 }
 t.diffuse=bare;
 t.pdf=pdf;
 t.weight=log2(luminanceOf(pdf)+1.0);
 return t;
}
@compute @workgroup_size(8,8,1)
fn ${STOCHASTIC_GENERATE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 let texel=surfaceTexel(page,coord*LG_TILE+at.xy);
 let texelIndex=at.x+at.y*LG_TILE;
 let samples=lp.stochasticSamples;
 let lightCount=min(directLights.count,LIGHT_MASK_WORDS*32u);
 let words=(lightCount+31u)/32u;
 for(var w=lane;w<words;w+=${WORKGROUP_THREADS}u){
  atomicStore(&candidateMask[w],0u);
  atomicStore(&pickedMask[w],0u);
 }
 workgroupBarrier();
 // The lights that reach the tile, a light a lane: the tile's box over the card's whole depth.
 let box=tileBox(page,coord,vec2f(0.0,1.0));
 for(var rank=lane;rank<lightCount;rank+=${WORKGROUP_THREADS}u){
  if(tileLightReached(directLights.items[rank],box)){atomicOr(&candidateMask[rank/32u],1u<<(rank%32u));}
 }
 workgroupBarrier();
 // The lights each texel picks, a texel a lane, walking the candidates by rank.
 var rankOf=array<u32,${MAX_SAMPLES}>(NO_RANK,NO_RANK,NO_RANK,NO_RANK);
 var weight=array<f32,${MAX_SAMPLES}>();
 var diffuse=array<vec3f,${MAX_SAMPLES}>();
 var random=array<f32,${MAX_SAMPLES}>();
 var weightSum=0.0;
 var pdfSum=vec3f(0.0);
 if(texel.valid){
  let base=blueNoiseScalar(coord*LG_TILE+at.xy,lp.noiseFrame);
  for(var s=0u;s<samples;s++){random[s]=(base+f32(s))/f32(samples);}
  for(var w=0u;w<words;w++){
   var bits=atomicLoad(&candidateMask[w]);
   while(bits!=0u){
    let rank=w*32u+firstTrailingBit(bits);
    bits&=bits-1u;
    let picked=lightTarget(rank,standaloneLight(rank),texel);
    if(picked.weight>lp.stochasticMinWeight){
     let tau=weightSum/(weightSum+picked.weight);
     weightSum+=picked.weight;
     pdfSum+=picked.pdf;
     for(var s=0u;s<samples;s++){
      if(random[s]<tau){
       random[s]/=tau;
      }else{
       random[s]=(random[s]-tau)/(1.0-tau);
       rankOf[s]=rank;
       weight[s]=picked.weight;
       diffuse[s]=picked.diffuse;
      }
      random[s]=clamp(random[s],0.0,0.9999);
     }
    }
   }
  }
  for(var s=0u;s<samples;s++){
   if(rankOf[s]!=NO_RANK){atomicOr(&pickedMask[rankOf[s]/32u],1u<<(rankOf[s]%32u));}
  }
 }
 workgroupBarrier();
 // The lights picked, the unique lights of the tile in order of rank, appended as its light tiles.
 if(lane==0u){
  var wanted=0u;
  for(var w=0u;w<words;w++){
   var bits=atomicLoad(&pickedMask[w]);
   while(bits!=0u){
    let rank=w*32u+firstTrailingBit(bits);
    bits&=bits-1u;
    tilePicks[wanted]=(lightKind(directLights.items[rank],standaloneLight(rank))<<14u)|rank;
    wanted++;
   }
  }
  pickedCount=appendTileLights(tile,wanted);
 }
 workgroupBarrier();
 // Each sample names its light by its place among the tile's, a light the list of light tiles had no room for picked by none.
 for(var s=0u;s<samples;s++){
  var packed=packSample(NO_LIGHT,false,true,0.0);
  var given=vec3f(0.0);
  for(var k=0u;k<pickedCount;k++){
   if(rankOf[s]!=NO_RANK&&(tilePicks[k]&0x3fffu)==rankOf[s]){
    packed=packSample(k,true,!castsShadow(directLights.items[rankOf[s]]),weightSum/(f32(samples)*weight[s]));
    given=diffuse[s];
   }
  }
  sampleData[sampleSlot(tile,texelIndex,s)]=vec4u(bitcast<vec3u>(given),packed);
 }
 sampleData[sampleSlot(tile,texelIndex,samples)]=vec4u(bitcast<u32>(luminanceOf(pdfSum)),0u,0u,0u);
}`,
  [
    lightingCommonWgsl({ tables: G.tables, context: { binding: G.context, access: 'read' } }),
    lightTileCountsWgsl(G.counts, 'atomic'),
    surfaceTexelWgsl(lightingLayersWgsl(G.depth, G.normal)),
    tileLightAppendWgsl(
      { culled: G.culled, cardTileOffsets: G.cardTileOffsets, standalone: G.standalone },
      MAX_TILE_PICKS,
    ),
    TILE_LIGHT_REACH_WGSL,
    SAMPLE_WGSL,
    blueNoiseWgsl(0, G.noise),
    CM_PER_M_WGSL,
    DIRECT_LIGHT_WGSL,
    lightStrengthWgsl(VIEW_EXPOSURE),
    LIGHT_CENTRE_FACING_WGSL,
    hasLightFunctionWgsl,
    lightFunctionReadWgsl(STOCHASTIC_GENERATE_LIGHT_FUNCTION),
    lightProfileOfWgsl(STOCHASTIC_GENERATE_LIGHT_PROFILE),
    rectSourceWgsl(rectBindingsOf(STOCHASTIC_GENERATE_LIGHT_PROFILE)),
    declaredLightWgsl({}, { term: 'bareIrradiance' }),
  ],
)

// ---------------------------------------------------------------------------------------------------------------------------- compact

export const STOCHASTIC_COMPACT_BINDINGS = {
  tables: 1,
  context: 2,
  cardTileLights: 3,
  cardTileOffsets: 4,
  samples: 5,
  masks: 6,
  traces: 7,
  depth: 8,
  normal: 9,
} as const
const C = STOCHASTIC_COMPACT_BINDINGS

export const STOCHASTIC_COMPACT_ENTRY = 'stochasticCompact'

const stochasticCompactProgram = (format: AtlasFormat) =>
  wgslProgram(
    `@group(0) @binding(${C.samples}) var<storage,read> sampleData:array<vec4u>;
@group(0) @binding(${C.masks}) var<storage,read> masks:array<u32>;
@group(0) @binding(${C.traces}) var<storage,read_write> traces:array<atomic<u32>>;
var<workgroup> found:array<u32,${WORKGROUP_THREADS * MAX_SAMPLES}>;
var<workgroup> foundCount:atomic<u32>;
var<workgroup> foundBase:u32;
@compute @workgroup_size(8,8,1)
fn ${STOCHASTIC_COMPACT_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(lane==0u){atomicStore(&foundCount,0u);}
 workgroupBarrier();
 if(tile<ctxListed(LG_LIST_DIRECT)){
  let head=directTexel(tile,at.xy);
  let texelIndex=at.x+at.y*LG_TILE;
  let bit=shadowBit(at.xy);
  for(var s=0u;s<lp.stochasticSamples;s++){
   let packed=sampleData[sampleSlot(tile,texelIndex,s)].w;
   let light=sampleLight(packed);
   if(light==NO_LIGHT||light>=head.lights||sampleCompleted(packed)||!sampleVisible(packed)){continue;}
   let lightTile=tileLightMask(head,light);
   let byte=shadowByteIn(masks[lightTile*SHADOW_MASK_TILE_WORDS+bit/32u],bit);
   if(!shadowRayOf(byte).complete){
    let slot=atomicAdd(&foundCount,1u);
    found[slot]=packShadowTrace(lightTile,at.xy,0u);
   }
  }
 }
 workgroupBarrier();
 let count=atomicLoad(&foundCount);
 if(lane==0u&&count>0u){foundBase=atomicAdd(&traces[0],count);}
 workgroupBarrier();
 for(var i=lane;i<count;i+=${WORKGROUP_THREADS}u){atomicStore(&traces[1u+foundBase+i],found[i]);}
}`,
    [
      lightingCommonWgsl({ tables: C.tables, context: { binding: C.context, access: 'read' } }),
      surfaceTexelWgsl(lightingLayersWgsl(C.depth, C.normal)),
      directTexelWgsl(C),
      SAMPLE_WGSL,
      shadowMaskBlockOf(format),
    ],
  )

// ---------------------------------------------------------------------------------------------------------------------------- shade

export const STOCHASTIC_SHADE_BINDINGS = {
  tables: 1,
  context: 2,
  depth: 3,
  normal: 4,
  cardTileLights: 5,
  cardTileOffsets: 6,
  samples: 7,
  masks: 8,
  out: 9,
  resolved: 10,
} as const
const S = STOCHASTIC_SHADE_BINDINGS

export const STOCHASTIC_SHADE_ENTRY = 'stochasticShade'

/** The format of the atlas the resolved light is written to, before it is blended. */
export const STOCHASTIC_RESOLVED_FORMAT: GPUTextureFormat = 'rgba16float'

const stochasticShadeProgram = (format: AtlasFormat, light: LightAtlasFormat) =>
  wgslProgram(
    `@group(0) @binding(${S.samples}) var<storage,read> sampleData:array<vec4u>;
@group(0) @binding(${S.masks}) var<storage,read> masks:array<u32>;
@group(0) @binding(${S.resolved}) var resolved:texture_storage_2d<${STOCHASTIC_RESOLVED_FORMAT},write>;
@compute @workgroup_size(8,8,1)
fn ${STOCHASTIC_SHADE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let head=directTexel(tile,at.xy);
 let texelIndex=at.x+at.y*LG_TILE;
 let bit=shadowBit(at.xy);
 var lighting=vec3f(0.0);
 if(head.texel.valid){
  for(var s=0u;s<lp.stochasticSamples;s++){
   let record=sampleData[sampleSlot(tile,texelIndex,s)];
   let packed=record.w;
   let light=sampleLight(packed);
   if(light==NO_LIGHT||light>=head.lights||!sampleVisible(packed)){continue;}
   let ray=shadowRayOf(shadowByteIn(masks[tileLightMask(head,light)*SHADOW_MASK_TILE_WORDS+bit/32u],bit));
   if(shadowReaches(ray.factor)){lighting+=sampleWeight(packed)*bitcast<vec3f>(record.xyz)*ray.factor;}
  }
 }
 if(lgFlag(FLAG_STOCHASTIC_TEMPORAL)){
  textureStore(resolved,vec2i(head.texel.atlas),vec4f(lighting,0.0));
 }else{
  storeDirect(head.page,head.texel,lighting);
 }
}`,
    [
      lightingCommonWgsl({ tables: S.tables, context: { binding: S.context, access: 'read' } }),
      surfaceTexelWgsl(lightingLayersWgsl(S.depth, S.normal)),
      directTexelWgsl(S),
      storeDirectWgsl(S.out, light),
      SAMPLE_WGSL,
      shadowMaskBlockOf(format),
    ],
  )

// ---------------------------------------------------------------------------------------------------------------------------- temporal

export const STOCHASTIC_TEMPORAL_BINDINGS = {
  tables: 1,
  context: 2,
  depth: 3,
  normal: 4,
  samples: 5,
  resolved: 6,
  historyLighting: 7,
  historyFrames: 8,
  lightingOut: 9,
  framesOut: 10,
  out: 11,
} as const
const T = STOCHASTIC_TEMPORAL_BINDINGS

export const STOCHASTIC_TEMPORAL_ENTRY = 'stochasticTemporal'

/** The format of the history's number of images accumulated: a float, where the reference's is an 8-bit normalised value (more precise, no loss). */
export const STOCHASTIC_FRAMES_FORMAT: GPUTextureFormat = 'r32float'

const temporalDeclarations = `@group(0) @binding(${T.samples}) var<storage,read> sampleData:array<vec4u>;
@group(0) @binding(${T.resolved}) var resolved:texture_2d<f32>;
@group(0) @binding(${T.historyLighting}) var historyLighting:texture_2d<f32>;
@group(0) @binding(${T.historyFrames}) var historyFrames:texture_2d<f32>;
@group(0) @binding(${T.lightingOut}) var lightingOut:texture_storage_2d<${STOCHASTIC_RESOLVED_FORMAT},write>;
@group(0) @binding(${T.framesOut}) var framesOut:texture_storage_2d<${STOCHASTIC_FRAMES_FORMAT},write>;
const NEIGHBOURS:i32=2;
struct Neighbourhood{lower:vec3f,upper:vec3f}`

const temporalNeighbourhood = `/** The mean of the 5 × 5 texels round \`atlas\`, inside the page \`lo\` up to \`hi\` (exclusive), plus and minus the clamp scale of their standard deviation. */
fn neighbourhoodOf(atlas:vec2u,centre:vec3f,lo:vec2u,hi:vec2u)->Neighbourhood{
 var sum=centre;
 var squares=centre*centre;
 for(var y=-NEIGHBOURS;y<=NEIGHBOURS;y++){
  for(var x=-NEIGHBOURS;x<=NEIGHBOURS;x++){
   if(x==0&&y==0){continue;}
   let at=clamp(vec2i(atlas)+vec2i(x,y),vec2i(lo),vec2i(hi)-vec2i(1));
   let c=textureLoad(resolved,at,0).xyz;
   sum+=c;
   squares+=c*c;
  }
 }
 let count=f32((2*NEIGHBOURS+1)*(2*NEIGHBOURS+1));
 let mean=sum/count;
 let deviation=sqrt(max(squares/count-mean*mean,vec3f(0.0)));
 return Neighbourhood(mean-lp.stochasticClampScale*deviation,mean+lp.stochasticClampScale*deviation);
}
fn clampLuminance(c:vec3f,limit:f32)->vec3f{
 let l=luminanceOf(c);
 return select(c,c*(limit/l),l>limit);
}`

const temporalEntry = `@compute @workgroup_size(8,8,1)
fn ${STOCHASTIC_TEMPORAL_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let texel=surfaceTexel(page,tileCoordOf(packed)*LG_TILE+at.xy);
 let atlas=texel.atlas;
 let sampleLuminance=bitcast<f32>(sampleData[sampleSlot(tile,at.x+at.y*LG_TILE,lp.stochasticSamples)].x);
 var lighting=textureLoad(resolved,vec2i(atlas),0).xyz;
 var moment=pow(luminanceOf(lighting),2.0);
 var frames=0.0;
 if(lgFlag(FLAG_STOCHASTIC_HISTORY)){
  let history=textureLoad(historyLighting,vec2i(atlas),0);
  frames=min(textureLoad(historyFrames,vec2i(atlas),0).x*lp.stochasticMaxFrames+1.0,lp.stochasticMaxFrames);
  let near=neighbourhoodOf(atlas,lighting,pageMin(page),pageMin(page)+pageSize(page));
  var kept=clampLuminance(clamp(history.xyz,near.lower,near.upper),sampleLuminance);
  let keptMoment=clamp(history.w,0.0,sampleLuminance*sampleLuminance);
  let alpha=1.0/(1.0+frames);
  lighting=mix(kept,lighting,alpha);
  moment=mix(keptMoment,moment,alpha);
 }
 lighting=select(vec3f(0.0),lighting,all(lighting==lighting)&&all(abs(lighting)<vec3f(3.0e38)));
 textureStore(lightingOut,vec2i(atlas),vec4f(lighting,moment));
 textureStore(framesOut,vec2i(atlas),vec4f(select(0.0,(frames+0.5)/lp.stochasticMaxFrames,lp.stochasticMaxFrames>0.0),0.0,0.0,0.0));
 storeDirect(page,texel,lighting);
}`

/** The temporal blend's program, the direct light stored in `light`. */
export const stochasticTemporalProgramOf = (light: LightAtlasFormat) =>
  wgslProgram(
    `${temporalDeclarations}
${temporalNeighbourhood}
${temporalEntry}`,
    [
      lightingCommonWgsl({ tables: T.tables, context: { binding: T.context, access: 'read' } }),
      surfaceTexelWgsl(lightingLayersWgsl(T.depth, T.normal)),
      storeDirectWgsl(T.out, light),
      SAMPLE_WGSL,
    ],
  )

const COMPACT_PROGRAMS = {
  grey: stochasticCompactProgram('grey'),
  colour: stochasticCompactProgram('colour'),
}
export const stochasticCompactProgramOf = (format: AtlasFormat) => COMPACT_PROGRAMS[format]
export const stochasticShadeProgramOf = (format: AtlasFormat, light: LightAtlasFormat) =>
  stochasticShadeProgram(format, light)
