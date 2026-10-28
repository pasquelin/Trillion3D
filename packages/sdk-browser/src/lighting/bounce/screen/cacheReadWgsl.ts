import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bilinear3 } from '../../../../../math/src/wgsl/sampling.ts'
import {
  WORD_LIGHT_FORMAT,
  lightAtlasScalar,
  lightOfTexel,
  lightReadDeps,
  type LightAtlasFormat,
} from '../../../gpu/core/lightAtlasFormat.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { REFLECTION_ENVIRONMENT_WGSL } from '../../reflections/field.ts'
import { CACHE_WORDS_WGSL } from '../cache/cacheWordsWgsl.ts'
import { rawWordChannel } from '../cache/cacheRawWgsl.ts'

/** Where the eight probes round a point are kept: shared by the workgroup of a probe, a lane gathering each (`spCacheGather`), or
 *  private to a thread that reads the cache for a ray of its own (`spCacheGatherOwn`). */
export type CacheGatherScope = 'workgroup' | 'private'

/** The cache's bindings, and the probes the workgroup or thread gathered (`CacheGathered`: each corner's slot and place, the point's fractions between the probes, the level held plus
 *  one, none for zero), which a pass that shares the gather among threads copies whole. */
const cacheGatheredWgsl = (
  final: number,
  raw: number,
  sky: number,
  scope: CacheGatherScope,
  light: LightAtlasFormat,
) => `@group(0) @binding(${final}) var cacheFinal:texture_2d<${lightAtlasScalar(light)}>;
@group(0) @binding(${raw}) var cacheRaw:texture_2d<u32>;
@group(0) @binding(${sky}) var cacheSky:texture_2d<f32>;
struct CacheSample{radiance:vec3f,distance:f32,sky:f32,}
struct CacheGathered{corner:array<u32,8>,place:array<vec3f,8>,alpha:vec3f,levelHeld:u32,}
var<${scope}> cacheNow:CacheGathered;
fn spCacheRes()->u32{return u32(sp.cache.y);}
/** Whether the cache covers the point the workgroup gathered for. */
fn spCacheCovers()->bool{return cacheNow.levelHeld!=0u;}
/** The probe at corner \`lane\` of the eight round a point whose first is the cell \`bottom\`, in the level \`cover\` names: its slot and place, none where
 *  the cell holds none. */
fn spCacheCorner(cover:CacheCoverage,bottom:vec3i,spacing:f32,lane:u32){
 cacheNow.corner[lane]=0u;
 if(!cover.valid){return;}
 let cell=bottom+vec3i(vec3u(lane&1u,(lane>>1u)&1u,(lane>>2u)&1u));
 let slot=cacheSlotOf(cover.level,cell);
 if(slot!=0u){
  cacheNow.corner[lane]=slot;
  cacheNow.place[lane]=probePosition(cell,spacing);
 }
}
`

/** The gather of the eight probes round a point, by the workgroup's lanes or by one thread. */
const cacheHeldWgsl = `/** The level held plus one and the fractions of the point between its eight probes, kept in \`cacheNow\` (none held for zero). */
fn spCacheHeld(cover:CacheCoverage,P:vec3f){
 cacheNow.levelHeld=select(0u,cover.level+1u,cover.valid);
 cacheNow.alpha=probeFraction(cover.level,P);
}
`

const cacheGatherWgsl = (scope: CacheGatherScope) =>
  scope === 'workgroup'
    ? `/** The probes round \`P\` the workgroup reads, found by its lanes: a lane the corner of its rank. */
fn spCacheGather(P:vec3f,lane:u32){
 let cover=cacheCoverage(P,0.0);
 if(lane==0u){
  spCacheHeld(cover,P);
 }
 if(lane>=8u){return;}
 spCacheCorner(cover,probeBottomCell(cover.level,P),bounce.levels[cover.level].spacing,lane);
}`
    : `/** The probes round \`P\` the thread reads, all eight found by it, in the level \`bias\` coarser than the one that covers it (\`random\`: the number the level is chosen with, \`cacheCoverage\`). */
fn spCacheGatherOwnBiased(P:vec3f,bias:u32,random:f32){
 let cover=cacheCoverageBiased(P,bias,random);
 let spacing=bounce.levels[cover.level].spacing;
 let bottom=probeBottomCell(cover.level,P);
 spCacheHeld(cover,P);
 for(var lane=0u;lane<8u;lane++){spCacheCorner(cover,bottom,spacing,lane);}
}
fn spCacheGatherOwn(P:vec3f){spCacheGatherOwnBiased(P,0u,0.0);}`

/** The texel reads of a probe's map: the taps, the light of a level, the light at a fraction of a level, the sky share. */
const cacheTexelsText = (light: LightAtlasFormat) => `
/** The border of a final map's first level, in texels: one doubled for each level of detail past the first, so that the coarsest keeps one. */
fn spCacheBorder()->u32{return 1u<<(u32(sp.cache.z)-1u);}
/** The four taps round the point \`q\` of a final map at \`tile\`, in texels of the map from the corner of its border, less a half: the texels'
 *  coordinates. The border holds the map's edge wrapped (\`fixupMaps\`), so that the taps at the edge stay inside the probe's square. */
fn spCacheTaps(tile:vec2u,q:vec2f,at:u32)->vec2i{
 return vec2i(tile+vec2u(vec2i(floor(q))+vec2i(i32(at&1u),i32(at>>1u))));
}
/** The light of the map of detail \`level\` of the probe in slot \`slot\` along the point \`uv\` of the square: its four texels round it, bilinear,
 *  taken out of the pre-exposure the maps keep it under (\`bounce.reach.w\`). */
fn spCacheLevel(slot:u32,uv:vec2f,res:u32,level:u32)->vec3f{
 let border=spCacheBorder();
 let tile=cacheTileOf(slot,(res+2u*border)>>level);
 let q=uv*f32(res>>level)+vec2f(f32(border>>level)-0.5);
 var taps=array<vec3f,4>();
 for(var i=0u;i<4u;i++){taps[i]=${lightOfTexel(light, 'textureLoad(cacheFinal,spCacheTaps(tile,q,i),i32(level))')};}
 return bilinear3(taps[0],taps[1],taps[2],taps[3],q-floor(q))*bounce.reach.w;
}
/** The light along the point \`uv\` at the level of detail \`mip\` (a fraction: the two levels it lies between, mixed). */
fn spCacheRadiance(slot:u32,uv:vec2f,res:u32,mip:f32)->vec3f{
 let low=u32(floor(mip));
 let near=spCacheLevel(slot,uv,res,low);
 let high=min(low+1u,u32(sp.cache.z)-1u);
 if(high==low||fract(mip)==0.0){return near;}
 return mix(near,spCacheLevel(slot,uv,res,high),fract(mip));
}
/** The share of the rays that left the scene, along the point \`uv\` of the map of the probe in slot \`slot\`: bilinear. */
fn spCacheSky(slot:u32,uv:vec2f,res:u32)->f32{
 let border=spCacheBorder();
 let tile=cacheTileOf(slot,res+2u*border);
 let q=uv*f32(res)+vec2f(f32(border)-0.5);
 var taps=array<f32,4>();
 for(var i=0u;i<4u;i++){taps[i]=textureLoad(cacheSky,spCacheTaps(tile,q,i),0).r;}
 let f=q-floor(q);
 return mix(mix(taps[0],taps[1],f.x),mix(taps[2],taps[3],f.x),f.y);
}`

/** What a probe gives along a ray, the cache's sample, and what lies past the screen; the distance word is read from the raw atlas of the format `light`. */
const cacheSampleText = (light: LightAtlasFormat) => `
/** What the probe at corner \`i\` gives along the ray \`d\` from \`P\`, of a cone \`size\` texels of its grid a side: nothing where it holds no map. */
fn spCacheProbe(i:u32,P:vec3f,d:vec3f,res:u32,size:f32)->CacheSample{
 // The table names a probe by its slot plus one, zero for none (\`traced\`): its maps lie at the slot itself.
 let named=cacheNow.corner[i];
 if(named==0u){return CacheSample(vec3f(0.0),0.0,0.0);}
 let slot=named-1u;
 let radius=sp.cache.x*cacheMinTrace(cacheNow.levelHeld-1u);
 let local=P-cacheNow.place[i];
 let b=dot(d,local);
 let reach=b*b-(dot(local,local)-radius*radius);
 let t=select(-1.0,sqrt(max(reach,0.0))-b,reach>=0.0);
 let towards=local+d*t;
 let correction=t*t/(radius*dot(towards,d));
 let uv=equalAreaEncode(towards);
 let mip=clamp(log2(f32(res)/size),0.0,sp.cache.z-1.0);
 let word=textureLoad(cacheRaw,vec2i(cacheTileOf(slot,res)+min(vec2u(uv*f32(res)),vec2u(res-1u))),0).${rawWordChannel(light, 'rg')};
 let apart=spFlag(SP_FLAG_CACHE_SKY);
 return CacheSample(
  spCacheRadiance(slot,uv,res,mip)*correction,
  cacheDepthOf(word),
  select(0.0,spCacheSky(slot,uv,res),apart));
}
/** The cache's light and distance along the ray \`d\` from the point \`P\` the workgroup gathered for, of a cone \`size\` texels of its
 *  grid a side: the eight probes' weighed by the fractions of the point between them, the sky filled in where it is kept apart. */
fn spCacheSample(P:vec3f,d:vec3f,size:f32)->CacheSample{
 var out=CacheSample(vec3f(0.0),0.0,0.0);
 let res=spCacheRes();
 let a=cacheNow.alpha;
 for(var i=0u;i<8u;i++){
  let share=mix(vec3f(1.0)-a,a,vec3f(f32(i&1u),f32((i>>1u)&1u),f32((i>>2u)&1u)));
  let weight=share.x*share.y*share.z;
  let s=spCacheProbe(i,P,d,res,size);
  out.radiance+=s.radiance*weight;
  out.distance+=s.distance*weight;
  out.sky+=s.sky*weight;
 }
 if(out.sky>0.0&&skyLit()){out.radiance=mix(out.radiance,skyProbeRadiance(d),out.sky);}
 return out;
}
/** What lies past the screen and the near scene: its light, the distance it reads (what the sky light that leaks onto it is weighed at) and the distance
 *  the ray's word keeps, which is the furthest a ray looks where the probes' rays of the cache all met no surface (their greatest, \`CACHE_MAX_HIT\`). */
struct SpFar{radiance:vec3f,distance:f32,stored:f32,}
/** What lies past the screen and the near scene along \`d\` from \`P\`, of a cone \`size\` texels of the probe's grid a side. */
fn spFarOf(P:vec3f,d:vec3f,size:f32)->SpFar{
 if(spFlag(SP_FLAG_CACHE)&&spCacheCovers()){
  let s=spCacheSample(P,d,size);
  // The eight probes' shares add to one up to the rounding of the sum.
  let reached=s.distance>=CACHE_MAX_HIT*(1.0-1e-6);
  return SpFar(s.radiance,s.distance,select(s.distance,spMaxTrace(),reached));
 }
 return SpFar(reflectionEnvironment(d,0.0),spMaxTrace(),spMaxTrace());
}`

/**
 * THE RADIANCE CACHE AS A SCREEN PROBE READS IT: the light the world's probes hold along a direction, interpolated between the
 * eight probes round the point (`spCacheSample`), their final maps `sp.cache.y` texels a side read at `cacheFinal` (with
 * `sp.cache.z` levels of detail), the distances their rays went and, where the sky is kept apart, the share of their rays that left
 * the scene at `cacheRaw` and `cacheSky`. The caller names the three bindings.
 *
 * The eight probes are found once for a point (`spCacheCorner`, the level that covers it — `cacheCoverage`; none, `spCacheCovers`
 * false, and the caller reads the sky —, the eight probes round it and their places — the probe the table names for
 * the cell, which it publishes once its map is traced, else none, which gives no light and no distance —, and the weights of the interpolation, the fractions
 * of the point between them): by the workgroup of a probe, a lane each (`spCacheGather`, the caller's barrier after), or by a thread
 * for the point of its own ray (`spCacheGatherOwn`), as `scope` says. A ray then reads each probe by
 * a direction moved onto the sphere round it of radius `sp.cache.x` times the nearest a ray of its probe starts
 * (`spCacheProbe`: the far root of the ray against the sphere, the direction from the probe to that point, the light scaled by
 * `t² / (radius · direction·ray)` so that moving toward a texel does not brighten it), its map's four texels round the direction
 * (bilinear, over the border the final atlas keeps; between the two levels of detail the width of the ray's cone, `size` texels
 * of its own grid a side, asks) and the distance of its nearest texel's ray. The share of the probes' rays that left the scene,
 * interpolated the same way, fills the light with the sky itself along the ray (`spCacheSky`). `spFarOf` is a ray's answer
 * past the screen and the near scene: the cache's, with the distance it reads (the greatest a probe's ray holds, `CACHE_MAX_HIT`, where the probes' rays met
 * no surface, which the ray's word then keeps as the furthest a ray looks); the environment's, at the ray's reach, where the cache covers no point of it.
 * The final maps are read as the format `light` stores them (`lightOfTexel`).
 */
export const spCacheRead = (
  final: number,
  raw: number,
  sky: number,
  scope: CacheGatherScope = 'workgroup',
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) =>
  wgslBlock(
    `spCacheRead(${final}, ${raw}, ${sky}, ${scope}, ${light})`,
    [
      CACHE_WORDS_WGSL,
      ...lightReadDeps(light),
      bilinear3,
      REFLECTION_ENVIRONMENT_WGSL,
      SKY_READ_WGSL,
    ],
    cacheGatheredWgsl(final, raw, sky, scope, light) +
      cacheHeldWgsl +
      cacheGatherWgsl(scope) +
      cacheTexelsText(light) +
      cacheSampleText(light),
  )
