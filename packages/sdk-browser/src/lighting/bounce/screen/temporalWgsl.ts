import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { ACCUMULATION_WGSL } from '../../../post/taa/accumulationWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spHistory } from './historyWgsl.ts'
import { spIntegrate } from './integrateWgsl.ts'
import { spProbes, spSurface } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** The temporal pass's bindings: the image's normals and flags, this image's occlusion, the last image's history and the
 *  one written, the surfaces' vectors, and what the integration of each pixel reads — the probes' pixels, each tile's adaptive
 *  probes (their count, their list), their irradiance, the share of their rays that move and their records. */
export const TEMPORAL_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  occlusion: [3, 'float'],
  history: [4, 'uint'],
  historyOut: [5, { store: F.history }],
  vectors: [6, 'uint'],
  pixels: [7, 'buffer-read'],
  header: [8, 'buffer-read'],
  indices: [9, 'buffer-read'],
  irradiance: [10, 'float'],
  moving: [11, 'buffer-read'],
  info: [12, 'float'],
  normal: [13, 'float'],
  counts: [14, 'buffer-read'],
})

const B = TEMPORAL_BINDINGS.at

/**
 * THE OCCLUSION OF THIS IMAGE at a pixel, as strong as the setting says (`sp.spatial.w`: `spOcclusionAt`; its texel, the
 * occlusion's own size being the image's over its downsample), the mean and the deviation of it over the three by three
 * pixels round one (`spOcclusionHood`), and the lowest and the highest light of the three by three pixels round one that read
 * some (`spLightRange`, the pixels integrated as the pass integrates its own).
 */
const SP_TEMPORAL_HOODS = wgslBlock(
  'SP_TEMPORAL_HOODS',
  [],
  `@group(0) @binding(${B.occlusion}) var occlusionIn:texture_2d<f32>;
fn spOcclusionAt(pixel:vec2i)->f32{
 let last=(vec2i(sp.size.xy)-vec2i(1))/vec2i(i32(SP_OCCLUSION_DOWNSAMPLE));
 let raw=textureLoad(occlusionIn,clamp(pixel/vec2i(i32(SP_OCCLUSION_DOWNSAMPLE)),vec2i(0),last),0).r;
 return mix(1.0,raw,sp.spatial.w);
}
fn spOcclusionHood(pixel:vec2i)->vec2f{
 var sum=0.0;
 var square=0.0;
 for(var i=0;i<9;i++){
  let value=spOcclusionAt(pixel+vec2i(i%3-1,i/3-1)*vec2i(i32(SP_OCCLUSION_DOWNSAMPLE)));
  sum+=value;
  square+=value*value;
 }
 let mean=sum/9.0;
 return vec2f(mean,sqrt(max(square/9.0-mean*mean,0.0)));
}
fn spLightRange(pixel:vec2i,light:vec3f)->array<vec3f,2>{
 var low=light;
 var high=light;
 for(var i=0;i<9;i++){
  let near=clamp(pixel+vec2i(i%3-1,i/3-1),vec2i(0),vec2i(sp.size.xy)-vec2i(1));
  let s=spSurfaceAt(vec2u(near));
  if(!s.lit){continue;}
  let read=spIntegrate(vec2u(near),s);
  if(read.a>0.0){
   low=min(low,read.rgb);
   high=max(high,read.rgb);
  }
 }
 return array<vec3f,2>(low,high);
}`,
)

/**
 * WHAT THE LAST IMAGE KEPT at a pixel, weighed over the four texels of its history (`spKeptOf`): the light and the occlusion,
 * their mean, and the weight held; a texel that kept none (no occlusion in its word: no lit surface was there) gives none.
 */
const SP_KEPT = wgslBlock(
  'SP_KEPT',
  [unpackLight],
  `struct SpKept{value:vec4f,held:f32,}
fn spKeptOf(h:SpHistory)->SpKept{
 var words=h.words;
 var value=vec4f(0.0);
 var held=0.0;
 for(var i=0u;i<4u;i++){
  if(h.weights[i]>0.0&&(words[i].y>>24u)!=0u){
   value+=vec4f(unpackLight(words[i].x),spMetaOcclusion(words[i].y))*h.weights[i];
   held+=h.weights[i];
  }
 }
 return SpKept(select(vec4f(0.0),value/held,held>0.0),held);
}`,
)

/**
 * THE TEMPORAL PASS: each pixel's irradiance (`spIntegrate`, the probes it reads) and occlusion blended with its history. The
 * history is where the pixel's surface was in the last image (`spReproject`: its four texels, bilinear, each kept only where
 * its own depth is the one the point is expected at). The frames it holds count up to `sp.counts.x`: a pixel's new light enters
 * at the engine's accumulation share (`accumulationShare`) of the frames held, so that a settled pixel averages as many images
 * as that and a pixel with no history takes the new light whole; where the new light is no reading (no probe weighed on the pixel,
 * `a` zero) the history leans on four times the count, and a pixel with neither a reading nor a history keeps nothing (its
 * occlusion is zero: the lighting reads the world's probes). THE FAST UPDATE: the share of the pixel's light that moves (the
 * alpha the integration left, `sp.motion.y` its inverse fraction) raises the amount the history gives way by — a fifth of it for
 * nothing, up to `sp.motion.z` —, held at the most of the history's own, and cuts the frames it holds to what is left of it; the
 * history is held to the new light's three-by-three neighbourhood meanwhile where the setting asks (`SP_FLAG_FAST_UPDATE_CLAMP`).
 * The history's occlusion is held within the mean of the occlusion's three-by-three neighbourhood this image, plus or minus its
 * deviation times `occlusionClampScale`: an occlusion that moved is followed, not ghosted. The pixel's depth, the amount of fast
 * update, the frames it now holds and its occlusion are kept for the next image (the meta word), its light in the other word:
 * what the lighting reads. A pixel on no lit surface keeps none.
 */
const SP_TEMPORAL = wgslBlock(
  'SP_TEMPORAL',
  [SP_TEMPORAL_HOODS, SP_KEPT, packLight, ACCUMULATION_WGSL],
  `@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${F.history},write>;
const SP_CLAMP_SCALE:f32=${SCREEN_PROBE_CONSTANTS.occlusionClampScale};
@compute @workgroup_size(8,8)
fn temporal(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=sp.size.xy)){return;}
 let at=vec2i(id.xy);
 let s=spSurfaceAt(id.xy);
 if(!s.lit){
  textureStore(historyOut,at,vec4u(0u));
  return;
 }
 let fresh=spIntegrate(id.xy,s);
 let reading=fresh.a>0.0;
 let occluded=spFlag(SP_FLAG_OCCLUSION);
 var out=vec4f(fresh.rgb,select(1.0,spOcclusionAt(at),occluded));
 var frames=0.0;
 var amount=0.0;
 let h=spReproject(id.xy,s.P,s.N,spNoise(id.xy,sp.size.w).x);
 let kept=spKeptOf(h);
 if(kept.held>0.0){
  var history=kept.value;
  let before=spHistoryKept(h);
  let longest=f32(sp.counts.x);
  var fast=saturate(abs(fresh.a)*sp.motion.y);
  fast=saturate(min((fast-0.2)/0.8,sp.motion.z));
  amount=fast;
  fast=max(fast,min(before.y,sp.motion.z));
  frames=min(min(before.x+1.0,longest),(1.0-fast)*longest);
  if(spFlag(SP_FLAG_FAST_UPDATE_CLAMP)&&fast>0.0){
   let range=spLightRange(at,fresh.rgb);
   history=vec4f(clamp(history.rgb,range[0],range[1]),history.a);
  }
  if(occluded){
   let hood=spOcclusionHood(at);
   history.a=clamp(history.a,hood.x-hood.y*SP_CLAMP_SCALE,hood.x+hood.y*SP_CLAMP_SCALE);
  }
  let held=select(frames,4.0*frames,!reading&&frames>=1.0);
  let most=select(longest,4.0*longest,!reading&&frames>=1.0);
  out=mix(history,out,accumulationShare(held,1.0,most+1.0));
 }else if(!reading){out=vec4f(0.0);}
 let word=vec4u(packLight(max(out.rgb,vec3f(0.0))),spMetaOf(surfaceLinearDepth(s.P),frames,amount,out.a),0u,0u);
 textureStore(historyOut,at,select(word,vec4u(0u),!reading&&kept.held<=0.0));
}`,
)

/** The temporal pass's program over the occlusion's `downsample` and `samples` of a tile. */
export const temporalShader = (downsample: number, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(B.params)}
${wgslConsts({ SP_OCCLUSION_DOWNSAMPLE: downsample })}`,
    [
      spCommon(samples),
      spSurface(B.normals, B.flags),
      spProbes(B.info, B.normal, B.counts),
      spHistory(B.history, B.vectors),
      spIntegrate(B),
      SP_TEMPORAL,
    ],
  )
