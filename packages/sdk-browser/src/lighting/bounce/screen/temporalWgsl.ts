import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { computeTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { BLUE_NOISE_FORMAT } from '../../../gpu/noise/blueNoiseTextures.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { ACCUMULATION_WGSL } from '../../../post/taa/accumulationWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { SP_BENT_WGSL, spHistory } from './historyWgsl.ts'
import { SP_OCCLUSION_CELLS } from './occlusionWgsl.ts'
import { spIntegrate } from './integrateWgsl.ts'
import { spProbes, spSurface } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** What the temporal pass binds of the pixels: the image's normals and flags, this image's occlusion, the last image's history (what
 *  the lighting reads), depths and shading, the ones written, the surfaces' vectors and the blue noise. With the reflection group's
 *  five, the pass reads the sixteen sampled textures a stage holds and writes the four storage textures it holds: the blue noise is read
 *  as a read-only storage texture (`blueNoiseWgsl`'s `loadOnly`), which the history's depths and shading take the sampled slot of. */
const PIXEL_BINDINGS = {
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  occlusion: [3, 'float'],
  history: [4, 'uint'],
  historyOut: [5, { store: F.history }],
  vectors: [6, 'uint'],
  depth: [16, 'float'],
  depthOut: [17, { store: F.depth }],
  shading: [19, 'uint'],
  shadingOut: [20, { store: F.shading }],
  blue: [15, { store: BLUE_NOISE_FORMAT, access: 'read-only' }],
} as const

/** The pixels' bindings alone: the pass of a level that casts no probe. */
const TEMPORAL_PIXEL_BINDINGS = bindingTable(PIXEL_BINDINGS)

/** The temporal pass's bindings where probes are cast: the pixels', and what the integration of each pixel reads — the probes'
 *  pixels, each tile's adaptive probes (their count, their list), their irradiance, the share of their rays that move, their
 *  records and their filtered radiance. */
export const TEMPORAL_BINDINGS = bindingTable({
  ...PIXEL_BINDINGS,
  pixels: [7, 'buffer-read'],
  header: [8, 'buffer-read'],
  indices: [9, 'buffer-read'],
  irradiance: [10, 'float'],
  moving: [11, 'buffer-read'],
  info: [12, 'float'],
  normal: [13, 'float'],
  counts: [14, 'buffer-read'],
  gather: [18, 'float'],
})

const B = TEMPORAL_BINDINGS.at

/** The layout of the temporal pass's group: the occlusion is read as a float, or, with the bent normal, as the word that holds it. */
export const temporalEntries = (probes: boolean, bentNormal: boolean) =>
  (probes ? TEMPORAL_BINDINGS : TEMPORAL_PIXEL_BINDINGS).entries.map((entry) =>
    entry.binding === B.occlusion && bentNormal ? computeTextureEntry(B.occlusion, 'uint') : entry,
  )

/** The occlusion texels of this image: the texel a pixel picks among the four round it, and the mean and
 *  deviation over the three by three round that one. */
const spOcclusionTexels = (
  bentNormal: boolean,
) => `@group(0) @binding(${B.occlusion}) var occlusionIn:texture_2d<${bentNormal ? 'u32' : 'f32'}>;
fn spOcclusionLast()->vec2i{return (vec2i(sp.size.xy)-vec2i(1))/vec2i(i32(SP_OCCLUSION_DOWNSAMPLE));}
fn spOcclusionTexel(cell:vec2i)->vec4f{
 let at=clamp(cell,vec2i(0),spOcclusionLast());
 ${bentNormal ? 'return spBentUnpack(textureLoad(occlusionIn,at,0).r);' : 'return vec4f(0.0,0.0,1.0,textureLoad(occlusionIn,at,0).r);'}
}
fn spOcclusionCell(pixel:vec2i,s:SpSurface,noise:f32)->vec2i{
 let last=spOcclusionLast();
 if(SP_OCCLUSION_DOWNSAMPLE==1u){return clamp(pixel,vec2i(0),last);}
 let base=vec2i(floor((vec2f(pixel)+vec2f(0.5))/f32(SP_OCCLUSION_DOWNSAMPLE)-vec2f(0.5)));
 let depth=max(surfaceLinearDepth(s.P),1e-3);
 var weights=vec4f(0.0);
 for(var i=0;i<4;i++){
  let cell=base+vec2i(i&1,i>>1);
  if(any(cell<vec2i(0))||any(cell>last)){continue;}
  let stand=vec2i(spOcclusionPixel(vec2u(cell)));
  let apart=abs(vec2f(stand-pixel));
  let triangle=max(2.0-apart.x,0.0)*max(2.0-apart.y,0.0);
  if(triangle<=0.0){continue;}
  let other=spSurfaceAt(vec2u(stand));
  if(!other.lit){continue;}
  let away=abs(dot(other.P-s.P,s.N))/depth;
  let angle=1.0-saturate(acos(saturate(dot(other.N,s.N))));
  weights[i]=triangle*exp2(-5000.0*away*away)*angle*angle;
 }
 let reach=vec4f(weights.x,weights.x+weights.y,weights.x+weights.y+weights.z,weights.x+weights.y+weights.z+weights.w);
 let pick=noise*reach.w;
 var k=3;
 if(pick<=reach.x&&weights.x>0.0){k=0;}
 else if(pick<=reach.y&&weights.y>0.0){k=1;}
 else if(pick<=reach.z&&weights.z>0.0){k=2;}
 return clamp(base+vec2i(k&1,k>>1),vec2i(0),last);
}
fn spOcclusionHood(cell:vec2i)->array<vec4f,2>{
 var sum=vec4f(0.0);
 var square=vec4f(0.0);
 for(var i=0;i<9;i++){
  let value=spOcclusionTexel(cell+vec2i(i%3-1,i/3-1));
  sum+=value;
  square+=value*value;
 }
 let mean=sum/9.0;
 return array<vec4f,2>(mean,sqrt(max(square/9.0-mean*mean,vec4f(0.0))));
}`

/** The occlusion held to the setting at a pixel: the strength it applies with and the open sky it leaves. */
const spOcclusionSky = (
  bentNormal: boolean,
) => `/** The occlusion \`o\` (direction in \`xyz\`, amount in \`w\`) with its amount mixed toward 1 by \`1 - strength\`. */
fn spFoliageAmount(o:vec4f,strength:f32)->vec4f{return vec4f(o.xyz,mix(1.0,o.w,strength));}
/** How strongly the occlusion applies at \`pixel\`: the setting's at a thin double-sided sheet, whole elsewhere. */
fn spStrengthAt(pixel:vec2i)->f32{
 return select(1.0,sp.foliage.x,(textureLoad(sceneFlags,pixel,0).r&${SUBSURFACE_FLAG}u)!=0u);
}
/** The open sky of the pixel whose occlusion texel is \`cell\`, of normal \`N\` that weighs the directions of its rough specular: the occlusion held to the setting's intensity
 *  (\`sp.foliage.y\`) and the pixel's \`strength\`, its direction a unit vector (the surface's own normal where the level keeps the amount alone),
 *  none (the normal, all of it) where the occlusion is off. */
fn spSkyAt(cell:vec2i,N:vec3f,strength:f32)->vec4f{
 if(!spFlag(SP_FLAG_OCCLUSION)){return vec4f(N,1.0);}
 let o=spOcclusionTexel(cell);
 let amount=mix(1.0,mix(1.0,o.w,sp.foliage.y),strength);
 ${bentNormal ? 'return vec4f(select(N,normalize(o.xyz),dot(o.xyz,o.xyz)>1e-8),amount);' : 'return vec4f(N,amount);'}
}`

/** The workgroup's tile of integrated neighbours, and the range of light and rough specular of the three by three round a pixel. */
const SP_LIGHT_RANGE = `/** The workgroup's pixels and their border, the texels the fast update's neighbourhood reads, each integrated once for all the pixels
 *  that read it: the light in \`xyz\`, \`w\` whether the pixel is lit and read some; the rough specular. \`rangeNeeded\` marks the tile texel of each
 *  pixel that clamps (the centre of its three by three), \`rangeAsked\` whether any pixel of the workgroup did. */
const SP_RANGE_SIDE:u32=SP_GROUP+2u;
const SP_RANGE_TEXELS:u32=SP_RANGE_SIDE*SP_RANGE_SIDE;
var<workgroup> rangeNeeded:array<atomic<u32>,4>;
var<workgroup> rangeAsked:u32;
var<workgroup> rangeLight:array<vec4f,SP_RANGE_TEXELS>;
var<workgroup> rangeRough:array<vec3f,SP_RANGE_TEXELS>;
/** The tile texel of the neighbour \`k\` of the three by three round the pixel \`local\` of the workgroup. */
fn spRangeTexel(local:vec2u,k:u32)->u32{return (local.y+k/3u)*SP_RANGE_SIDE+local.x+k%3u;}
/** Marks the tile texel at the centre of the three by three the pixel \`local\` reads, and that the workgroup has a pixel that reads
 *  one: every pixel that asks stores the same \`1\` to \`rangeAsked\`. */
fn spRangeAsk(local:vec2u){
 let t=spRangeTexel(local,4u);
 atomicOr(&rangeNeeded[t>>5u],1u<<(t&31u));
 rangeAsked=1u;
}
/** Whether the texel \`t\` of the tile is read by a pixel that asked: one of the texels of its three by three, inside the tile, is marked. */
fn spRangeWanted(t:u32)->bool{
 let side=i32(SP_RANGE_SIDE);
 let x=i32(t%SP_RANGE_SIDE);
 let y=i32(t/SP_RANGE_SIDE);
 for(var k=0;k<9;k++){
  let nx=x+k%3-1;
  let ny=y+k/3-1;
  if(nx<0||ny<0||nx>=side||ny>=side){continue;}
  let n=u32(ny*side+nx);
  if(((atomicLoad(&rangeNeeded[n>>5u])>>(n&31u))&1u)!=0u){return true;}
 }
 return false;
}
/** Integrates the texels of the tile that a marked texel's three by three holds of the workgroup \`group\`, thread \`lane\` taking every \`SP_GROUP\` squared th of them: a pixel
 *  that is lit and reads some keeps its light and rough specular, integrated as the pass integrates its own. */
fn spRangeFill(group:vec2u,lane:u32){
 for(var t=lane;t<SP_RANGE_TEXELS;t+=SP_GROUP*SP_GROUP){
  if(!spRangeWanted(t)){continue;}
  let near=clamp(vec2i(group*SP_GROUP)+vec2i(i32(t%SP_RANGE_SIDE),i32(t/SP_RANGE_SIDE))-vec2i(1),vec2i(0),vec2i(sp.size.xy)-vec2i(1));
  var light=vec4f(0.0);
  var rough=vec3f(0.0);
  let s=spSurfaceAt(vec2u(near));
  if(s.lit){
   var cell=vec2i(0);
   if(spFlag(SP_FLAG_OCCLUSION)){cell=spOcclusionCell(near,s,blueNoiseScalar(vec2u(near),sp.size.w));}
   let read=spIntegrate(vec2u(near),s,true,false,spSkyAt(cell,s.N,spStrengthAt(near)));
   if(read.light.a>0.0){
    light=vec4f(read.light.rgb,1.0);
    rough=read.rough;
   }
  }
  rangeLight[t]=light;
  rangeRough[t]=rough;
 }
}
/** The lowest and the highest light and rough specular of the three by three pixels round the pixel \`local\` that read some, with its own \`light\` and \`rough\`. */
fn spLightRange(local:vec2u,light:vec3f,rough:vec3f)->array<vec3f,4>{
 var low=light;
 var high=light;
 var lowRough=rough;
 var highRough=rough;
 for(var k=0u;k<9u;k++){
  let t=spRangeTexel(local,k);
  let read=rangeLight[t];
  if(read.w>0.0){
   low=min(low,read.xyz);
   high=max(high,read.xyz);
   lowRough=min(lowRough,rangeRough[t]);
   highRough=max(highRough,rangeRough[t]);
  }
 }
 return array<vec3f,4>(low,high,lowRough,highRough);
}`

/**
 * THE OCCLUSION OF THIS IMAGE at a pixel, as the search found it (`spOcclusionTexel`, the occlusion's own size being the image's
 * over its downsample). The texel a pixel reads is picked stochastically among the four round it (`spOcclusionCell`): each stands for
 * the full-size pixel the search ran from (`spOcclusionPixel`), is weighed by its triangle distance to the pixel, how near the pixel's
 * plane that pixel's point lies and how near its normal is the pixel's, and the pixel's blue noise picks one by those weights (the
 * last where none weighs); the texel picked is also the centre of the neighbourhood the history's occlusion is clamped to. The texel holds: the direction of the open sky in `xyz` and the amount of it in `w` —
 * with the bent normal the word the pass wrote (`spBentUnpack`), else the amount alone and a direction that is none (`(0, 0, 1)`
 * for every pixel) —, the mean and the deviation of the four numbers over the three by three
 * texels round the one picked (`spOcclusionHood`), and the lowest and the highest light and rough specular of the three by three pixels round one that read
 * some (`spLightRange`, the pixels integrated as the pass integrates its own).
 */
const SP_TEMPORAL_HOODS = (bentNormal: boolean) =>
  wgslBlock(
    `SP_TEMPORAL_HOODS(${bentNormal})`,
    [SP_BENT_WGSL, SP_OCCLUSION_CELLS],
    [spOcclusionTexels(bentNormal), spOcclusionSky(bentNormal), SP_LIGHT_RANGE].join('\n'),
  )

/**
 * WHAT THE LAST IMAGE KEPT at a pixel, weighed over the four texels of its history (`spKeptOf`): the light, the rough specular
 * light and the backface's, the occlusion with the direction of the open sky (`xyz`, `w`: `spBentUnpack`, not unit once weighed),
 * their means, and the weight held; a texel that kept none (no occlusion in its word: no lit surface was there) gives none.
 */
const SP_KEPT = wgslBlock(
  'SP_KEPT',
  [unpackLight, SP_BENT_WGSL],
  `@group(0) @binding(${B.history}) var historyIn:texture_2d<u32>;
struct SpKept{light:vec3f,rough:vec3f,back:vec3f,occlusion:vec4f,held:f32,}
fn spKeptOf(h:SpHistory)->SpKept{
 var light=vec3f(0.0);
 var rough=vec3f(0.0);
 var back=vec3f(0.0);
 var occlusion=vec4f(0.0);
 var held=0.0;
 for(var i=0u;i<4u;i++){
  if(h.weights[i]>0.0){
   let word=textureLoad(historyIn,h.texel+vec2i(i32(i&1u),i32(i>>1u)),0);
   if(word.w!=0u){
    light+=unpackLight(word.x)*h.weights[i];
    rough+=unpackLight(word.y)*h.weights[i];
    back+=unpackLight(word.z)*h.weights[i];
    occlusion+=spBentUnpack(word.w)*h.weights[i];
    held+=h.weights[i];
   }
  }
 }
 if(held<=0.0){return SpKept(vec3f(0.0),vec3f(0.0),vec3f(0.0),vec4f(0.0),0.0);}
 return SpKept(light/held,rough/held,back/held,occlusion/held,held);
}`,
)

/** The temporal kernel's pixel: its fresh light and occlusion, its reprojected history and how fast its light moves. */
const spTemporalPixel = (
  probes: boolean,
) => `@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${F.history},write>;
@group(0) @binding(${B.depthOut}) var depthOut:texture_storage_2d<${F.depth},write>;
@group(0) @binding(${B.shadingOut}) var shadingOut:texture_storage_2d<${F.shading},write>;
@compute @workgroup_size(SP_GROUP,SP_GROUP)
fn temporal(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let inside=all(id.xy<sp.size.xy);
 let at=vec2i(min(id.xy,sp.size.xy-vec2u(1u)));
 let s=spSurfaceAt(vec2u(at));
 let live=inside&&s.lit;
 if(inside&&!s.lit){
  textureStore(historyOut,at,vec4u(0u));
  textureStore(depthOut,at,vec4f(0.0));
  textureStore(shadingOut,at,vec4u(0u));
 }
 let strength=select(1.0,sp.foliage.x,live&&s.foliage);
 let occluded=spFlag(SP_FLAG_OCCLUSION);
 let longest=f32(sp.counts.x);
 var noise=0.0;
 var fresh:SpIntegrated;
 var h:SpHistory;
 var kept:SpKept;
 var cell=vec2i(0);
 var frames=0.0;
 var amount=0.0;
 var fast=0.0;
 if(live){
  noise=blueNoiseScalar(id.xy,sp.size.w);
  if(occluded){cell=spOcclusionCell(at,s,noise);}
  fresh=spIntegrate(vec2u(at),s,${probes},s.backface,spSkyAt(cell,s.N,strength));
  h=spReproject(vec2u(at),s.P,s.N,s.backface,noise);
  kept=spKeptOf(h);
  if(kept.held>0.0){
   let before=spHistoryKept(h);
   fast=saturate(abs(fresh.light.a)*sp.motion.y);
   fast=saturate(min((fast-0.2)/0.8,sp.motion.z));
   amount=fast;
   fast=max(fast,min(before.y,sp.motion.z));
   frames=min(min(before.x+1.0,longest),(1.0-fast)*longest);
  }
 }`

/** The temporal kernel's tile: the workgroup's texels the pixels that clamp read, integrated once for all of them. */
const SP_TEMPORAL_TILE = ` let local=vec2u(lane%SP_GROUP,lane/SP_GROUP);
 let clamped=live&&kept.held>0.0&&spFlag(SP_FLAG_FAST_UPDATE_CLAMP)&&fast>0.0;
 if(lane<4u){atomicStore(&rangeNeeded[lane],0u);}
 if(lane==4u){rangeAsked=0u;}
 workgroupBarrier();
 if(clamped){spRangeAsk(local);}
 workgroupBarrier();
 // The whole workgroup fills, or none of it: the barrier after the fill is never divergent.
 if(workgroupUniformLoad(&rangeAsked)!=0u){
  spRangeFill(group.xy,lane);
  workgroupBarrier();
 }`

/** The temporal kernel's light, rough specular, back and occlusion as the pixel's own, before the blend with the history. */
const spTemporalOwn = (probes: boolean) => ` let reading=${probes ? 'fresh.light.a>0.0' : 'true'};
 var light=fresh.light.rgb;
 var rough=fresh.rough;
 var back=fresh.back;
 // A thin double-sided sheet takes the occlusion at most as strongly as the setting says: its amount is mixed toward 1, the
 // light scattering through the sheet; the neighbourhood the history is held to is mixed the same way.
 var occlusion=vec4f(0.0);
 if(live){occlusion=spFoliageAmount(select(vec4f(0.0,0.0,1.0,1.0),spOcclusionTexel(cell),occluded),strength);}`

/** The temporal kernel up to the neighbourhood the fast update holds the history to: the pixel's fresh light and occlusion, its reprojected
 *  history, how fast its light moves, and the workgroup's texels the pixels that clamp read, integrated once. A thread past the image or on no lit
 *  surface goes through the barriers all the same and does nothing else. */
const spTemporalFresh = (probes: boolean) =>
  [spTemporalPixel(probes), SP_TEMPORAL_TILE, spTemporalOwn(probes)].join('\n')

/** The temporal kernel from the blend: the history held, mixed with the fresh light and written. */
const spTemporalBlend = (bentNormal: boolean) => ` if(!live){return;}
 if(kept.held>0.0){
  var history=kept.light;
  var historyRough=kept.rough;
  var historyOcclusion=${bentNormal ? 'kept.occlusion' : 'vec4f(0.0,0.0,1.0,kept.occlusion.w)'};
  if(clamped){
   let range=spLightRange(local,fresh.light.rgb,fresh.rough);
   history=clamp(history,range[0],range[1]);
   historyRough=clamp(historyRough,range[2],range[3]);
  }
  if(occluded&&spFlag(SP_FLAG_OCCLUSION_TEMPORAL)&&sp.occlusion.w>0.0){
   let hood=spOcclusionHood(cell);
   let around=spFoliageAmount(hood[0],strength);
   let spread=hood[1]*vec4f(1.0,1.0,1.0,strength)*sp.occlusion.w;
   historyOcclusion=clamp(historyOcclusion,around-spread,around+spread);
  }
  let held=select(frames,4.0*frames,!reading&&frames>=1.0);
  let most=select(longest,4.0*longest,!reading&&frames>=1.0);
  let share=accumulationShare(held,1.0,most+1.0);
  light=mix(history,light,share);
  rough=mix(historyRough,rough,share);
  back=mix(kept.back,back,share);
  occlusion=select(occlusion,mix(historyOcclusion,occlusion,share),spFlag(SP_FLAG_OCCLUSION_TEMPORAL));
 }else if(!reading){
  light=vec3f(0.0);
  rough=vec3f(0.0);
  back=vec3f(0.0);
  occlusion=vec4f(0.0);
 }
 let direction=${bentNormal ? 'select(s.N,normalize(occlusion.xyz),dot(occlusion.xyz,occlusion.xyz)>1e-8)' : 's.N'};
 let noHistory=!reading&&kept.held<=0.0;
 let word=vec4u(
  packLight(ditherLight(max(light,vec3f(0.0)),noise)),
  packLight(ditherLight(max(rough,vec3f(0.0)),noise)),
  packLight(ditherLight(max(back,vec3f(0.0)),noise)),
  spBentPack(direction*clamp(occlusion.w,1.0/255.0,1.0)));
 textureStore(historyOut,at,select(word,vec4u(0u),noHistory));
 textureStore(depthOut,at,vec4f(select(s.z,0.0,noHistory),0.0,0.0,0.0));
 textureStore(shadingOut,at,vec4u(select(spShadingPack(s.N,s.hair,s.backface),0u,noHistory),select(spFramesOf(frames,amount),0u,noHistory),0u,0u));
}`

/**
 * THE TEMPORAL PASS: each pixel's irradiance, rough specular and back (`spIntegrate`, the probes it reads) and occlusion blended with
 * their history. The
 * history is where the pixel's surface was in the last image (`spReproject`: its four texels, bilinear, each kept only where
 * its own depth is the one the point is expected at and it lights its backface as the pixel does). The frames it holds count up to `sp.counts.x`: a pixel's new light enters
 * at the engine's accumulation share (`accumulationShare`) of the frames held, so that a settled pixel averages as many images
 * as that and a pixel with no history takes the new light whole; where the new light is no reading (no probe weighed on the pixel,
 * `a` zero) the history leans on four times the count, and a pixel with neither a reading nor a history keeps nothing (its
 * occlusion is zero: the lighting takes the sky light's irradiance). THE FAST UPDATE: the share of the pixel's light that moves (the
 * alpha the integration left, `sp.motion.y` its inverse fraction) raises the amount the history gives way by — a fifth of it for
 * nothing, up to `sp.motion.z` —, held at the most of the history's own, and cuts the frames it holds to what is left of it; the
 * history of the light and of the rough specular is held to the new values' three-by-three neighbourhood meanwhile where the
 * setting asks (`SP_FLAG_FAST_UPDATE_CLAMP`). The history's occlusion, its amount and the direction of the open sky, is held within the mean of the
 * occlusion's three-by-three neighbourhood this image, plus or minus its deviation times `screenProbeOcclusionClampScale`, each of
 * the four numbers apart (no clamp where it is not above zero, or where the occlusion is not temporal): an occlusion that moved is
 * followed, not ghosted. The pixel's device depth, its normal with its marks, and the frames it now holds with the amount of fast
 * update are kept for the next image, its light, rough specular, back and occlusion in the
 * words the lighting reads (the occlusion's direction, with the bent normal, the unit direction of the blend; else the surface's own
 * normal). A pixel on no lit surface keeps none.
 */
const spTemporal = (probes: boolean, bentNormal: boolean) =>
  wgslBlock(
    `SP_TEMPORAL(${probes}, ${bentNormal})`,
    [
      SP_TEMPORAL_HOODS(bentNormal),
      SP_KEPT,
      SP_BENT_WGSL,
      packLight,
      ditherLight,
      ACCUMULATION_WGSL,
    ],
    [spTemporalFresh(probes), spTemporalBlend(bentNormal)].join('\n'),
  )

/** The pass of a level that casts no probe: no light is read, the pixel keeps its occlusion alone. */
const SP_NO_PROBES = wgslBlock(
  'SP_NO_PROBES',
  [],
  `struct SpIntegrated{light:vec4f,rough:vec3f,back:vec3f,}
fn spIntegrate(pixel:vec2u,s:SpSurface,withRough:bool,withBack:bool,sky:vec4f)->SpIntegrated{return SpIntegrated(vec4f(0.0),vec3f(0.0),vec3f(0.0));}`,
)

/** The temporal pass's program over the occlusion's `downsample` (kept with the bent normal where `bentNormal`) and `samples` of a tile,
 *  integrating the probes where `probes` (the level casts them), else over the pixels' bindings alone. */
export const temporalShader = (
  downsample: number,
  samples: readonly [number, number],
  probes: boolean,
  bentNormal: boolean,
) =>
  wgslProgram(
    `${spParams(B.params)}
${wgslConsts({ SP_OCCLUSION_DOWNSAMPLE: downsample, SP_GROUP: 8 })}`,
    [
      spCommon(samples),
      spSurface(B.normals, B.flags),
      ...(probes ? [spProbes(B.info, B.normal, B.counts)] : []),
      spHistory(B.depth, B.shading, B.vectors),
      blueNoiseWgsl(0, B.blue, true),
      probes ? spIntegrate(B) : SP_NO_PROBES,
      spTemporal(probes, bentNormal),
    ],
  )
