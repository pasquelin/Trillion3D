import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { downsampleBase } from '../../../../../math/src/wgsl/sampling.ts'
import { computeTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { ACCUMULATION_WGSL } from '../../../post/taa/accumulationWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { SP_BENT_WGSL, spHistory } from './historyWgsl.ts'
import { spOcclusionRead } from './occlusionReadWgsl.ts'
import { spSurface } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** What the temporal pass binds of the pixels: the image's normals and flags, this image's occlusion, the last image's history (what
 *  the lighting reads) and shading and depth (their normals and frames, their depths), the ones written, the surfaces' vectors and the blue noise. */
const PIXEL_BINDINGS = {
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  occlusion: [3, 'float'],
  history: [4, 'uint'],
  historyOut: [5, { store: F.history }],
  vectors: [6, 'uint'],
  shading: [7, 'uint'],
  shadingOut: [8, { store: F.shading }],
  keptDepth: [12, 'float'],
  keptDepthOut: [13, { store: F.keptDepth }],
  blue: [15, 'float'],
} as const

/** The pixels' bindings alone: the pass of a level that casts no probe. */
const TEMPORAL_PIXEL_BINDINGS = bindingTable(PIXEL_BINDINGS)

/** The temporal pass's bindings where probes are cast: the pixels', and what the integration of the probes left of each pixel — its light
 *  with the share of it that moves, its rough specular and its back (each the 11-11-10 word, `packLight`) —, and, where the integration is downsampled, the texel
 *  of it each pixel reads (`offsets`). */
export const TEMPORAL_BINDINGS = bindingTable({
  ...PIXEL_BINDINGS,
  light: [9, 'float'],
  rough: [10, 'uint'],
  back: [11, 'uint'],
  offsets: [14, { store: F.offsets, access: 'read-only' }],
})

const B = TEMPORAL_BINDINGS.at

/** The layout of the temporal pass's group: the occlusion is read as a float, or, with the bent normal, as the word that holds it; the offsets are read
 *  where the integration is downsampled (`integrate` above one) and the level casts probes. */
export const temporalEntries = (probes: boolean, bentNormal: boolean, integrate: number) =>
  (probes ? TEMPORAL_BINDINGS : TEMPORAL_PIXEL_BINDINGS).entries
    .filter((entry) => entry.binding !== B.offsets || integrate > 1)
    .map((entry) =>
      entry.binding === B.occlusion && bentNormal
        ? computeTextureEntry(B.occlusion, 'uint')
        : entry,
    )

/** The mean and deviation over the three by three round the texel picked, taken in the workgroup's tile of occlusion. */
const SP_OCCLUSION_HOOD = `/** The texels a side of the workgroup's tile of occlusion, which the neighbourhood is taken in: the workgroup's pixels over the
 *  downsample, and a texel of border either side. */
const SP_TILE_SIDE:i32=i32(SP_GROUP/SP_OCCLUSION_DOWNSAMPLE)+2;
/** Where the texel picked lies in the workgroup's tile, for the pixel \`local\` of the workgroup. */
fn spOcclusionInTile(pick:SpOcclusionPick,local:vec2u)->vec2i{
 if(SP_OCCLUSION_DOWNSAMPLE==1u){return vec2i(local)+vec2i(1);}
 let downsample=i32(SP_OCCLUSION_DOWNSAMPLE);
 return vec2i((vec2i(local)+vec2i(downsample-1))/vec2i(downsample))+pick.moved;
}
/** The mean and the deviation of the texel picked and of the eight round it that lie in the workgroup's tile. */
fn spOcclusionHood(pick:SpOcclusionPick,local:vec2u)->array<vec4f,2>{
 let inTile=spOcclusionInTile(pick,local);
 let centre=spOcclusionTexel(pick.cell);
 var sum=centre;
 var square=centre*centre;
 var taps=1.0;
 for(var i=0;i<9;i++){
  let offset=vec2i(i%3-1,i/3-1);
  let at=inTile+offset;
  if(i==4||any(at<vec2i(0))||any(at>=vec2i(SP_TILE_SIDE))){continue;}
  let value=spOcclusionTexel(pick.cell+offset);
  sum+=value;
  square+=value*value;
  taps+=1.0;
 }
 let mean=sum/taps;
 return array<vec4f,2>(mean,sqrt(max(square/taps-mean*mean,vec4f(0.0))));
}`

/** The lowest and the highest light and rough specular of the eight texels round the texel `at` of the integration (held in its texels: the ones past its edge are the edge's) and of the pixel's own
 *  `light` and `rough`, as the integration left them: a pixel that read no probe left zero, which counts. */
const SP_LIGHT_RANGE = `fn spLightRange(at:vec2i,light:vec3f,rough:vec3f)->array<vec3f,4>{
 var low=light;
 var high=light;
 var lowRough=rough;
 var highRough=rough;
 let last=spFreshLast();
 for(var k=0;k<9;k++){
  if(k==4){continue;}
  let near=clamp(at+vec2i(k%3-1,k/3-1),vec2i(0),last);
  let nearLight=textureLoad(lightIn,near,0).rgb;
  let nearRough=unpackLight(textureLoad(roughIn,near,0).r);
  low=min(low,nearLight);
  high=max(high,nearLight);
  lowRough=min(lowRough,nearRough);
  highRough=max(highRough,nearRough);
 }
 return array<vec3f,4>(low,high,lowRough,highRough);
}`

/**
 * THE OCCLUSION HOOD of a pixel, with the occlusion of this image (`spOcclusionRead`): the mean and the deviation of the four numbers over the three by three
 * texels round the one picked that lie in the workgroup's tile of them (`spOcclusionHood`).
 */
const SP_TEMPORAL_HOODS = (bentNormal: boolean) =>
  wgslBlock(
    `SP_TEMPORAL_HOODS(${bentNormal})`,
    [spOcclusionRead(B.occlusion, bentNormal)],
    SP_OCCLUSION_HOOD,
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

/** Where a pixel finds what the integration left of it: its own texel where the integration is not downsampled (`integrate` one), else the one of the four round it
 *  that its offset names (`downsampleBase`, the same cell the offset was picked from in `stochasticWgsl.ts`, the offset past it, held to the integration's texels) and whether the four could stand for it.
 *  The offsets are read as the storage they are written through, so that none of the stage's sixteen sampled textures is spent on them. */
const spFreshAt = (integrate: number) =>
  wgslBlock(
    `spFreshAt(${integrate})`,
    integrate > 1 ? [downsampleBase] : [],
    `/** The texel of the integration a pixel reads, and whether it could stand for the pixel. */
struct SpFreshAt{texel:vec2i,valid:bool,}
${
  integrate > 1
    ? `@group(0) @binding(${B.offsets}) var offsetsIn:texture_storage_2d<${F.offsets},read>;
fn spFreshLast()->vec2i{return (vec2i(sp.size.xy)+vec2i(${integrate - 1}))/vec2i(${integrate})-vec2i(1);}
fn spFreshAt(at:vec2i)->SpFreshAt{
 let word=textureLoad(offsetsIn,at).r;
 let texel=downsampleBase(at,${integrate})+vec2i(i32(word&1u),i32((word>>1u)&1u));
 return SpFreshAt(clamp(texel,vec2i(0),spFreshLast()),(word&4u)!=0u);
}`
    : `fn spFreshLast()->vec2i{return vec2i(sp.size.xy)-vec2i(1);}
fn spFreshAt(at:vec2i)->SpFreshAt{return SpFreshAt(at,true);}`
}`,
  )

/** What the integration left of a pixel: its light with the share of it that moves, its rough specular and its back; none where the level casts no probe. */
const spFresh = (integrate: number) =>
  wgslBlock(
    `spFresh(${integrate})`,
    [spFreshAt(integrate)],
    `@group(0) @binding(${B.light}) var lightIn:texture_2d<f32>;
@group(0) @binding(${B.rough}) var roughIn:texture_2d<u32>;
@group(0) @binding(${B.back}) var backIn:texture_2d<u32>;
${SP_LIGHT_RANGE}`,
  )

/** The temporal kernel's pixel: its fresh light and occlusion, its reprojected history and how fast its light moves. */
const spTemporalPixel = (
  probes: boolean,
) => `@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${F.history},write>;
@group(0) @binding(${B.shadingOut}) var shadingOut:texture_storage_2d<${F.shading},write>;
@group(0) @binding(${B.keptDepthOut}) var keptDepthOut:texture_storage_2d<${F.keptDepth},write>;
@compute @workgroup_size(SP_GROUP,SP_GROUP)
fn temporal(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(any(id.xy>=sp.size.xy)){return;}
 let at=vec2i(id.xy);
 let local=vec2u(lane%SP_GROUP,lane/SP_GROUP);
 let s=spSurfaceAt(id.xy);
 // A pixel that is no lit surface keeps no light, but the depth it showed.
 if(!s.lit){
  textureStore(historyOut,at,vec4u(0u));
  textureStore(shadingOut,at,vec4u(0u));
  textureStore(keptDepthOut,at,vec4f(s.z,0.0,0.0,0.0));
  return;
 }
 // Where the integration applied the occlusion to the light already, the history keeps none of it.
 let occluded=spFlag(SP_FLAG_OCCLUSION)&&!spFlag(SP_FLAG_OCCLUSION_IN_INTEGRATION);
 let longest=f32(sp.counts.x);
 // The texel of the occlusion a pixel reads and the depth test of its history are drawn at the stochastic lighting's frame, the last blend of its light at the probes' gather state's.
 let noise=blueNoiseScalar(id.xy,sp.frames.z);
 let dither=blueNoiseScalar(id.xy,sp.frames.x);
 var pick=SpOcclusionPick(vec2i(0),vec2i(0),true);
 if(occluded){pick=spOcclusionCell(at,s,noise);}
 ${
   probes
     ? `let fresh=spFreshAt(at);
 let freshLight=textureLoad(lightIn,fresh.texel,0);
 let freshRough=unpackLight(textureLoad(roughIn,fresh.texel,0).r);
 let freshBack=unpackLight(textureLoad(backIn,fresh.texel,0).r);`
     : `let freshLight=vec4f(0.0);
 let freshRough=vec3f(0.0);
 let freshBack=vec3f(0.0);`
 }
 let h=spReproject(id.xy,s.P,s.N,s.foliage,noise);
 let kept=spKeptOf(h);
 var frames=0.0;
 var amount=0.0;
 var fast=0.0;
 if(kept.held>0.0){
  let before=spHistoryKept(h);
  fast=saturate(abs(freshLight.a)*sp.motion.y);
  fast=saturate(min((fast-0.2)/0.8,sp.motion.z));
  amount=fast;
  fast=max(fast,min(before.y,sp.motion.z));
  frames=min(min(before.x+1.0,longest),(1.0-fast)*longest);
 }
 let clamped=kept.held>0.0&&spFlag(SP_FLAG_FAST_UPDATE_CLAMP)&&fast>0.0;`

/** The temporal kernel's light, rough specular, back and occlusion as the pixel's own, before the blend with the history. */
const spTemporalOwn = (
  probes: boolean,
) => ` let reading=${probes ? 'freshLight.a>0.0&&fresh.valid' : 'true'};
 // The light is trusted where it was read and an occlusion texel could stand for the pixel.
 let trusted=reading&&pick.valid;
 var light=freshLight.rgb;
 var rough=freshRough;
 var back=freshBack;
 // The history keeps the occlusion as the search found it: the strength a pixel with backface diffuse light takes it at is the lighting's.
 var occlusion=select(vec4f(0.0,0.0,1.0,1.0),spOcclusionTexel(pick.cell),occluded);`

/** The temporal kernel up to the neighbourhood the fast update holds the history to: the pixel's fresh light and occlusion, its reprojected
 *  history and how fast its light moves. */
const spTemporalFresh = (probes: boolean) =>
  [spTemporalPixel(probes), spTemporalOwn(probes)].join('\n')

/** The temporal kernel from the blend: the history held, mixed with the fresh light and written. */
const spTemporalBlend = (probes: boolean, bentNormal: boolean) => ` if(kept.held>0.0){
  var history=kept.light;
  var historyRough=kept.rough;
  var historyOcclusion=${bentNormal ? 'kept.occlusion' : 'vec4f(0.0,0.0,1.0,kept.occlusion.w)'};
  ${
    probes
      ? `if(clamped){
   let range=spLightRange(fresh.texel,freshLight.rgb,freshRough);
   history=clamp(history,range[0],range[1]);
   historyRough=clamp(historyRough,range[2],range[3]);
  }`
      : ''
  }
  if(occluded&&spFlag(SP_FLAG_OCCLUSION_TEMPORAL)&&sp.occlusion.w>0.0){
   let hood=spOcclusionHood(pick,local);
   let spread=hood[1]*sp.occlusion.w;
   historyOcclusion=clamp(historyOcclusion,hood[0]-spread,hood[0]+spread);
  }
  let held=select(frames,4.0*frames,!trusted&&frames>=1.0);
  let most=select(longest,4.0*longest,!trusted&&frames>=1.0);
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
  packLight(ditherLight(max(light,vec3f(0.0)),dither)),
  packLight(ditherLight(max(rough,vec3f(0.0)),dither)),
  packLight(ditherLight(max(back,vec3f(0.0)),dither)),
  spBentPack(direction*clamp(occlusion.w,1.0/255.0,1.0)));
 textureStore(historyOut,at,select(word,vec4u(0u),noHistory));
 textureStore(shadingOut,at,vec4u(spShadingPack(s.N,s.foliage),select(spFramesOf(frames,amount),0u,noHistory),0u,0u));
 textureStore(keptDepthOut,at,vec4f(s.z,0.0,0.0,0.0));
}`

/**
 * THE TEMPORAL PASS: each pixel's irradiance, rough specular and back (what the integration of the probes left of it, `integratePassWgsl.ts`; where the integration is downsampled, what it
 * left at the texel the pixel's offset names, `spFreshAt`, no reading where no texel could stand for the pixel) and occlusion blended with
 * their history. The
 * history is where the pixel's surface was in the last image (`spReproject`: its four texels, bilinear, each kept only where
 * its own depth is the one the point is expected at and it has backface diffuse light as the pixel does). The frames it holds count up to `sp.counts.x`: a pixel's new light enters
 * at the engine's accumulation share (`accumulationShare`) of the frames held, so that a settled pixel averages as many images
 * as that and a pixel with no history takes the new light whole; where the new light is no reading (no probe weighed on the pixel,
 * `a` zero, or no occlusion texel could stand for the pixel) the history leans on four times the count, and a pixel with neither a
 * probe's reading nor a history keeps nothing (its occlusion is zero: the lighting takes the sky light's irradiance). THE FAST UPDATE: the share of the pixel's light that moves (the
 * alpha the integration left, `sp.motion.y` its inverse fraction) raises the amount the history gives way by — a fifth of it for
 * nothing, up to `sp.motion.z` —, held at the most of the history's own, and cuts the frames it holds to what is left of it; the
 * history of the light and of the rough specular is held to the range of the eight pixels round the pixel's integration (every one, those that read
 * no probe included) meanwhile where the setting asks (`SP_FLAG_FAST_UPDATE_CLAMP`). The history's occlusion, its amount and the direction of the open sky, is held within the mean of the
 * occlusion's three-by-three neighbourhood this image, plus or minus its deviation times `screenProbeOcclusionClampScale`, each of
 * the four numbers apart (no clamp where it is not above zero, or where the occlusion is not temporal): an occlusion that moved is
 * followed, not ghosted. The pixel's normal with its kind, the frames it now holds with the amount of fast
 * update, and the device depth it showed (whatever its surface) are kept for the next image, its light, rough specular, back and occlusion in the
 * words the lighting reads (the occlusion's direction, with the bent normal, the unit direction of the blend; else the surface's own
 * normal). Where the integration applied the occlusion to the light already (`screenProbeShortRangeAOApplyDuringIntegration`) the history keeps no
 * occlusion: its amount is one. A pixel on no lit surface keeps no light.
 */
const spTemporal = (probes: boolean, bentNormal: boolean, integrate: number) =>
  wgslBlock(
    `SP_TEMPORAL(${probes}, ${bentNormal}, ${integrate})`,
    [
      ...(probes ? [spFresh(integrate)] : []),
      SP_TEMPORAL_HOODS(bentNormal),
      SP_KEPT,
      SP_BENT_WGSL,
      packLight,
      ditherLight,
      ACCUMULATION_WGSL,
    ],
    [spTemporalFresh(probes), spTemporalBlend(probes, bentNormal)].join('\n'),
  )

/** The temporal pass's program over the occlusion's `downsample` (kept with the bent normal where `bentNormal`) and `samples` of a tile,
 *  blending the light the probes' integration left, run at the reduction `integrate`, where `probes` (the level casts them), else over the pixels' bindings alone. */
export const temporalShader = (
  downsample: number,
  samples: readonly [number, number],
  probes: boolean,
  bentNormal: boolean,
  integrate: number,
) =>
  wgslProgram(
    `${spParams(B.params)}
${wgslConsts({ SP_OCCLUSION_DOWNSAMPLE: downsample, SP_GROUP: 8 })}`,
    [
      spCommon(samples),
      spSurface(B.normals, B.flags),
      spHistory(B.shading, B.keptDepth, B.vectors),
      blueNoiseWgsl(0, B.blue),
      spTemporal(probes, bentNormal, integrate),
    ],
  )
