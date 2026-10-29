import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { ndcToPixel } from '../../../../../math/src/wgsl/projection.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { workgroupSortWgsl } from '../../../gpu/core/workgroupSortWgsl.ts'
import { workgroupSumLoop } from '../../../gpu/core/workgroupSumWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import {
  WORD_LIGHT_FORMAT,
  withLightAtlasEntry,
  type LightAtlasFormat,
} from '../../../gpu/core/lightAtlasFormat.ts'
import { CACHE_PDF_UNITS, CACHE_PDF_WORDS } from '../cache/cacheLayout.ts'
import { atlasEntry } from '../atlas.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spCacheRead } from './cacheReadWgsl.ts'
import { spPdfLobes, spProbes } from './probesWgsl.ts'
import {
  SCREEN_PROBE_FORMATS as F,
  PROBE_PIXEL_BINDINGS,
  bindingTable,
} from './screenProbeLayout.ts'
import { spVectors } from './vectorsWgsl.ts'

/** The rays' bindings: the probes' records and pixels, the last image's probes and their filtered radiance, the probes'
 *  coefficients of the pixels' directions, the ray words written, the cascades and the radiance cache's maps the far light is
 *  read from, the light buffer (the sky it holds), the surfaces' vectors of the image. */
export const RAYS_BINDINGS = bindingTable({
  ...PROBE_PIXEL_BINDINGS,
  historyInfo: [5, 'float'],
  historyGather: [6, 'float'],
  brdf: [7, 'buffer-read'],
  ray: [8, { store: F.ray }],
  bounceGrid: [9, 'uniform'],
  lights: [11, 'buffer-read'],
  blue: [12, 'float'],
  cacheFinal: [13, 'uint'],
  cacheRaw: [14, 'uint'],
  cacheSky: [15, 'float'],
  vectors: [17, 'uint'],
  lobes: [18, 'buffer'],
})
/** The atlas of the cascades' probes, which the rays' layout adds (`atlasEntry`). */
export const RAYS_PROBES = 10
export const raysEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => [
  ...withLightAtlasEntry(RAYS_BINDINGS.entries, RAYS_BINDINGS.at.cacheFinal, light),
  atlasEntry(RAYS_PROBES),
]

const B = RAYS_BINDINGS.at

/**
 * THE LIGHTING'S SHARE OF A PROBE'S DIRECTIONS: where the light is, the importance sampling's second half (`spLightLuminance`).
 * Its light comes from the last image, where there is one: the filtered radiance of the four probes round where the probe was
 * (`spHistoryLighting`: where its surface stood, by the camera's motion and its own (`spMotionOf`), none where that is off the last image, whose edge counts as in it; the last image's probes, those on its plane, `exp2(scale · (distance / depth)²)` over
 * `importanceHistoryMinWeight`), the share the last image does not give — one minus a quarter of the probes that did — from the
 * radiance cache through the direction (`spCacheSample`, the cone of the probe's rays one texel of its octahedron); where the cache covers no
 * point of the probe or is not read, one. A direction's luminance is that light's.
 */
const SP_LIGHTING = wgslBlock(
  'SP_LIGHTING',
  [ndcToPixel, luminance],
  `const SP_HISTORY_MIN_WEIGHT_PROBE:f32=${SCREEN_PROBE_CONSTANTS.importanceHistoryMinWeight};
const SP_HISTORY_PLANE_SCALE:f32=${SCREEN_PROBE_CONSTANTS.depthWeightScale};
@group(0) @binding(${B.historyInfo}) var historyInfo:texture_2d<f32>;
@group(0) @binding(${B.historyGather}) var historyGather:texture_2d<f32>;
/** The light of the last image's probes round the point \`P\` of normal \`N\`, standing on pixel \`pixel\`, direction texel \`t\`, its
 *  transparency — the share of the whole they did not give — in \`a\`. */
fn spHistoryLighting(P:vec3f,N:vec3f,depth:f32,pixel:vec2u,t:vec2u)->vec4f{
 var out=vec4f(0.0,0.0,0.0,1.0);
 let clip=reflectionView.radianceViewProj*vec4f(P,1.0);
 let size=reflectionView.radiance.xy;
 if(clip.w<=0.0){return out;}
 let px=ndcToPixel(spMotionOf(vec2i(pixel),P,clip.xy/clip.w).ndc,size);
 if(any(px<vec2f(0.0))||any(px>size)){return out;}
 let at=(px-vec2f(0.5)-vec2f(spTileJitter(sp.mode.y)))/f32(sp.size.z);
 var radiance=vec3f(0.0);
 var total=0.0;
 for(var i=0u;i<4u;i++){
  let probe=vec2u(clamp(at+vec2f(f32(i&1u),f32(i>>1u)),vec2f(0.0),vec2f(sp.grid.xy-vec2u(1u))));
  let kept=textureLoad(historyInfo,vec2i(probe),0);
  let away=abs(dot(kept.xyz,N)-dot(P,N))/depth;
  if(kept.w>=0.0&&exp2(SP_HISTORY_PLANE_SCALE*away*away)>SP_HISTORY_MIN_WEIGHT_PROBE){
   radiance+=textureLoad(historyGather,vec2i(probe*SP_GATHER+t*SP_GATHER/SP_TRACE),0).rgb;
   total+=1.0;
  }
 }
 if(total>0.0){out=vec4f(radiance/total,out.a);}
 out.a=1.0-saturate(total/4.0);
 return out;
}
/** The luminance of the light arriving along \`direction\` at the probe standing on pixel \`pixel\`, direction texel \`t\`. */
fn spLightLuminance(probe:SpProbe,pixel:vec2u,direction:vec3f,t:vec2u)->f32{
 var lighting=vec3f(0.0);
 var transparency=1.0;
 if(spFlag(SP_FLAG_RADIANCE_HISTORY)){
  let kept=spHistoryLighting(probe.P,probe.N,probe.depth,pixel,t);
  lighting=kept.rgb;
  transparency=kept.a;
 }
 if(transparency>0.0){
  if(spFlag(SP_FLAG_CACHE)&&spCacheCovers()){lighting+=transparency*spCacheSample(probe.P,direction,f32(SP_TRACE)).radiance;}
  else{lighting=vec3f(1.0);}
 }
 return luminance(lighting);
}`,
)

/** The ray's info as the sort keeps it: the texel and level, the probability's bits. */
const SP_RAY_INFO = wgslBlock(
  'SP_RAY_INFO',
  [],
  `fn spRayInfo(coord:vec2u,level:u32,pdf:f32)->vec2u{
 return vec2u((coord.x&255u)|((coord.y&255u)<<8u)|((level&255u)<<16u),bitcast<u32>(pdf));
}
fn spInfoCoord(info:vec2u)->vec2u{return vec2u(info.x&255u,(info.x>>8u)&255u);}
fn spInfoLevel(info:vec2u)->u32{return (info.x>>16u)&255u;}
fn spInfoPdf(info:vec2u)->f32{return bitcast<f32>(info.y);}`,
)

/**
 * THE DIRECTIONS A PROBE TRACES: the importance sampling. A group a probe, a thread each of its `R × R` rays. A texel's
 * probability is the cosine lobes' of the pixels the probe stands for in its direction (`screenData`: nine coefficients,
 * `spBasis`), times the lighting's over the uniform one and the count of texels; held to `sp.weights.z` where the cosine lobes
 * did not leave it under it, so that a direction the pixels see is never starved of rays by the light's darkness. The lighting's
 * probability is the luminance of the light of its direction over the sum of the probe's (`spLightLuminance`, the far field
 * gathered once for the probe, `spCacheGather`). The rays are sorted by their probability (the workgroup's bitonic network),
 * and for every three whose probability is under the minimum, the most probable one is traced as four, at twice the resolution
 * (`importanceLevels` one: the octahedron's texel and the next level down): the three rays the dark directions leave give
 * their share to the direction that wants it. A texel of the ray word names a ray by its octahedron texel and level
 * (`spPackRay`): the texels of the probe's rays, whatever their count, are always the `R × R` the probe owns.
 *
 * THE LOBES THE WORLD'S PROBES TRACE BY (`scatterLobes`): a group a probe, a thread of its first axis one of the eight world probes round the probe's
 * point (the level that covers it, as the cache is read), the threads of the second sharing the ten words: the probe's nine coefficients, and a one
 * for the weight, added to the world probe's sums (the cache sets them to nothing before, `clearLobes`), from which the cache cuts its trace tiles.
 */
const RAYS_WGSL = wgslBlock(
  'RAYS_WGSL',
  [SP_LIGHTING, SP_RAY_INFO],
  `@group(0) @binding(${B.pixels}) var<storage,read> probePixels:array<u32>;
@group(0) @binding(${B.ray}) var rayOut:texture_storage_2d<${F.ray},write>;
/** The rays of the probe, sorted by their probability. */
var<workgroup> rays:array<vec2u,SP_RAYS>;
var<workgroup> sums:array<f32,SP_RAYS>;
var<workgroup> subdivided:atomic<u32>;
/** The probability of the cosine lobes in direction \`d\`, from the probe's coefficients. */
fn spCosinePdf(index:u32,d:vec3f)->f32{
 let basis=spBasis(d);
 var pdf=0.0;
 for(var k=0u;k<9u;k++){pdf+=spPdfCoefficient(index,k)*basis[k];}
 return max(pdf,0.0);
}
/** The three rays of the lowest probabilities under the minimum take the place of the three the top ray's children fill. */
fn spRefine(lane:u32){
 var next=rays[lane];
 let merge=lane%3u;
 let order=lane/3u;
 let top=select(SP_RAYS-order-1u,0u,order+1u>SP_RAYS);
 let third=order*3u+2u;
 if(third<top&&spInfoPdf(rays[third])<sp.weights.z){
  let chosen=rays[top];
  next=spRayInfo(spInfoCoord(chosen)*2u+vec2u((merge+1u)%2u,(merge+1u)/2u),spInfoLevel(chosen)-1u,0.0);
  if(merge==0u){atomicAdd(&subdivided,1u);}
 }
 workgroupBarrier();
 rays[lane]=next;
 workgroupBarrier();
 if(lane<atomicLoad(&subdivided)){
  let chosen=rays[SP_RAYS-lane-1u];
  rays[SP_RAYS-lane-1u]=spRayInfo(spInfoCoord(chosen)*2u,spInfoLevel(chosen)-1u,0.0);
 }
 workgroupBarrier();
}
@compute @workgroup_size(SP_TRACE,SP_TRACE)
fn genRays(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=spIndexOf(group.xy);
 let probe=spProbeOrDead(group.xy);
 let live=probe.depth>0.0;
 let lit=spFlag(SP_FLAG_IMPORTANCE_LIGHTING);
 let t=vec2u(lane%SP_TRACE,lane/SP_TRACE);
 if(lane==0u){atomicStore(&subdivided,0u);}
 if(live&&lit&&spFlag(SP_FLAG_CACHE)){spCacheGather(probe.P,lane);}
 workgroupBarrier();
 var light=0.0;
 if(live&&lit){
  let direction=equalAreaDecode((vec2f(t)+blueNoiseVec2(spProbeTile(index,probePixels[index]),sp.mode.w))/f32(SP_TRACE));
  let own=probePixels[index];
  light=spLightLuminance(probe,vec2u(own&0xffffu,own>>16u),direction,t);
 }
 sums[lane]=light;
 ${workgroupSumLoop('SP_RAYS', 'sums[lane]+=sums[lane+stride];')}
 var pdf=0.0;
 if(live){
  pdf=spCosinePdf(index,equalAreaDecode((vec2f(t)+vec2f(0.5))/f32(SP_TRACE)));
  if(lit){
   let kept=pdf>=sp.weights.z;
   // The probability of the light is kept in a half float, as the reference's single-channel half target holds it.
   let share=unpack2x16float(pack2x16float(vec2f(light/max(sums[0],1e-4),0.0))).x;
   pdf*=share*f32(SP_RAYS);
   if(kept){pdf=max(pdf,sp.weights.z);}
  }
 }
 rays[lane]=spRayInfo(t,SP_IMPORTANCE_LEVELS,pdf);
 raysSort(lane);
 spRefine(lane);
 let settled=rays[lane];
 textureStore(rayOut,vec2i(group.xy*SP_TRACE+t),vec4u(spPackRay(spInfoCoord(settled),spInfoLevel(settled)),0u,0u,0u));
}
@group(0) @binding(${B.lobes}) var<storage,read_write> lobes:array<atomic<i32>>;
@compute @workgroup_size(8,8)
fn scatterLobes(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u){
 let probe=spProbeOrDead(group.xy);
 if(probe.depth<=0.0){return;}
 let cover=cacheCoverage(probe.P,0.0);
 if(!cover.valid){return;}
 let cell=probeBottomCell(cover.level,probe.P)+vec3i(vec3u(local.x&1u,(local.x>>1u)&1u,(local.x>>2u)&1u));
 let named=cacheSlotOf(cover.level,cell);
 if(named==0u){return;}
 let index=spIndexOf(group.xy);
 for(var k=local.y;k<${CACHE_PDF_WORDS}u;k+=8u){
  var coefficient=1.0;
  var units=1.0;
  if(k<9u){
   // A probe on foliage asks for none: the world probes it reads stay at the coarsest trace.
   coefficient=select(spPdfCoefficient(index,k),0.0,probe.foliage);
   units=${wgslF32(CACHE_PDF_UNITS)};
  }
  atomicAdd(&lobes[(named-1u)*${CACHE_PDF_WORDS}u+k],i32(coefficient*units));
 }
}`,
)

/** The rays' program over `side × side` rays a probe, the last image's light read from a gather of `gather × gather` texels, and `samples` of a tile. */
export const raysShader = (
  side: number,
  gather: number,
  samples: readonly [number, number],
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) => {
  const count = side * side
  return wgslProgram(
    `${spParams(B.params)}
${wgslConsts({ SP_TRACE: side, SP_RAYS: count, SP_GATHER: gather })}
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;`,
    [
      DIRECT_LIGHT_WGSL,
      bounceBindingsWgsl(0, B.bounceGrid, RAYS_PROBES),
      spCommon(samples),
      spProbes(B.info, B.normal, B.counts),
      spPdfLobes(B.brdf),
      spVectors(B.vectors),
      blueNoiseWgsl(0, B.blue),
      spCacheRead(B.cacheFinal, B.cacheRaw, B.cacheSky, 'workgroup', light),
      workgroupSortWgsl('rays', count),
      RAYS_WGSL,
    ],
  )
}
