import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bilinear3 } from '../../../../../math/src/wgsl/sampling.ts'
import { octWrapBorder } from '../../../../../math/src/wgsl/octahedral.ts'
import { unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { REFLECTION_ENVIRONMENT_WGSL } from '../../reflections/field.ts'
import { CACHE_WORDS_WGSL, cacheTagsWgsl } from '../cache/cacheWordsWgsl.ts'

/**
 * THE RADIANCE CACHE AS A SCREEN PROBE READS IT: the light the world's probes hold along a direction, interpolated between the
 * eight probes round the point (`spCacheSample`), their final maps `sp.cache.y` texels a side read at `cacheFinal` (with
 * `sp.cache.z` levels of detail), the distances their rays went and, where the sky is kept apart, the share of their rays that left
 * the scene at `cacheRaw` and `cacheSky`, the cells their maps were made for at `cacheTags`. The caller names the four bindings.
 *
 * The workgroup of a probe finds the eight probes once (`spCacheGather`, a lane each, the caller's barrier after): the level that
 * covers the probe's point (`cacheCoverage`; none, `spCacheCovers` false, and the caller reads the sky), the probes of the
 * eight cells round it and their places — a probe that holds the cell and whose map was made for it, else none, which gives no light and no
 * distance —, and the weights of the interpolation, the fractions of the point in its cell. A ray then reads each probe by
 * a direction moved onto the sphere round it of radius `sp.cache.x` times the nearest a ray of its probe starts
 * (`spCacheProbe`: the far root of the ray against the sphere, the direction from the probe to that point, the light scaled by
 * `t² / (radius · direction·ray)` so that moving toward a texel does not brighten it), its map's four texels round the direction
 * (bilinear, the border wrapped as an octahedron's; between the two levels of detail the width of the ray's cone, `size` texels
 * of its own grid a side, asks) and the distance of its nearest texel's ray. The share of the probes' rays that left the scene,
 * interpolated the same way, fills the light with the sky itself along the ray (`spCacheSky`). `spFarOf` is a ray's answer
 * past the screen and the near scene: the cache's, with the distance it reads where it holds one and the ray's reach where the ray
 * went further than a half float holds; the environment's, at the ray's reach, where the cache covers no point of it.
 */
export const spCacheRead = (final: number, raw: number, sky: number, tags: number) =>
  wgslBlock(
    `spCacheRead(${final}, ${raw}, ${sky}, ${tags})`,
    [
      CACHE_WORDS_WGSL,
      cacheTagsWgsl(tags, false),
      unpackLight,
      bilinear3,
      octWrapBorder,
      REFLECTION_ENVIRONMENT_WGSL,
      SKY_READ_WGSL,
    ],
    `@group(0) @binding(${final}) var cacheFinal:texture_2d<u32>;
@group(0) @binding(${raw}) var cacheRaw:texture_2d<u32>;
@group(0) @binding(${sky}) var cacheSky:texture_2d<f32>;
struct CacheSample{radiance:vec3f,distance:f32,sky:f32,}
var<workgroup> cacheCorner:array<u32,8>;
var<workgroup> cachePlace:array<vec3f,8>;
var<workgroup> cacheAlpha:vec3f;
var<workgroup> cacheLevelHeld:u32;
fn spCacheRes()->u32{return u32(sp.cache.y);}
/** Whether the cache covers the point the workgroup gathered for. */
fn spCacheCovers()->bool{return cacheLevelHeld!=0u;}
/** The probes round \`P\` the workgroup reads, found by its lanes: a lane the corner of its rank. */
fn spCacheGather(P:vec3f,lane:u32){
 let cover=cacheCoverage(P);
 let spacing=bounce.levels[cover.level].spacing;
 let local=P/spacing-vec3f(0.5);
 if(lane==0u){
  cacheLevelHeld=select(0u,cover.level+1u,cover.valid);
  cacheAlpha=fract(local);
 }
 if(lane>=8u){return;}
 cacheCorner[lane]=0u;
 if(!cover.valid){return;}
 let cell=vec3i(floor(local))+vec3i(vec3u(lane&1u,(lane>>1u)&1u,(lane>>2u)&1u));
 let slot=cacheSlotOf(cover.level,cell);
 if(slot!=0u&&cacheTagOk(slot,cell,cover.level)){
  cacheCorner[lane]=slot;
  cachePlace[lane]=probeCentre(cell,spacing);
 }
}
/** The four taps round the point \`uv\` of a map of \`res\` texels a side at \`tile\`: the texels' coordinates, the border wrapped, and the fraction. */
fn spCacheTaps(tile:vec2u,uv:vec2f,res:u32,at:u32)->vec2i{
 let q=uv*f32(res)-vec2f(0.5);
 let texel=vec2u(vec2i(floor(q))+vec2i(i32(at&1u),i32(at>>1u))+vec2i(1));
 return vec2i(tile+octWrapBorder(texel,res+2u,1u));
}
/** The light of the map of detail \`level\` of the probe in slot \`slot\` along the point \`uv\` of the square: its four texels round it, bilinear. */
fn spCacheLevel(slot:u32,uv:vec2f,res:u32,level:u32)->vec3f{
 let side=res>>level;
 let tile=cacheTileOf(slot,side);
 var taps=array<vec3f,4>();
 for(var i=0u;i<4u;i++){taps[i]=unpackLight(textureLoad(cacheFinal,spCacheTaps(tile,uv,side,i),i32(level)).r);}
 let q=uv*f32(side)-vec2f(0.5);
 return bilinear3(taps[0],taps[1],taps[2],taps[3],q-floor(q));
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
 let tile=cacheTileOf(slot,res);
 var taps=array<f32,4>();
 for(var i=0u;i<4u;i++){taps[i]=textureLoad(cacheSky,spCacheTaps(tile,uv,res,i),0).r;}
 let q=uv*f32(res)-vec2f(0.5);
 let f=q-floor(q);
 return mix(mix(taps[0],taps[1],f.x),mix(taps[2],taps[3],f.x),f.y);
}
/** What the probe at corner \`i\` gives along the ray \`d\` from \`P\`, of a cone \`size\` texels of its grid a side: nothing where it holds no map. */
fn spCacheProbe(i:u32,P:vec3f,d:vec3f,res:u32,size:f32)->CacheSample{
 let slot=cacheCorner[i];
 if(slot==0u){return CacheSample(vec3f(0.0),0.0,0.0);}
 let radius=sp.cache.x*cacheMinTrace(cacheLevelHeld-1u);
 let local=P-cachePlace[i];
 let b=dot(d,local);
 let reach=b*b-(dot(local,local)-radius*radius);
 let t=select(-1.0,sqrt(max(reach,0.0))-b,reach>=0.0);
 let towards=local+d*t;
 let correction=t*t/(radius*dot(towards,d));
 let uv=equalAreaEncode(towards);
 let mip=clamp(log2(f32(res)/size),0.0,sp.cache.z-1.0);
 let word=textureLoad(cacheRaw,vec2i(cacheTileOf(slot,res)+min(vec2u(uv*f32(res)),vec2u(res-1u))),0).g;
 let apart=spFlag(SP_FLAG_CACHE_SKY);
 return CacheSample(
  spCacheRadiance(slot,uv,res,mip)*correction,
  cacheDepthOf(word),
  select(0.0,spCacheSky(slot,uv,res),apart));
}
/** The cache's light and distance along the ray \`d\` from the point \`P\` the workgroup gathered for, of a cone \`size\` texels of its
 *  grid a side: the eight probes' weighed by the fractions of the point in its cell, the sky filled in where it is kept apart. */
fn spCacheSample(P:vec3f,d:vec3f,size:f32)->CacheSample{
 var out=CacheSample(vec3f(0.0),0.0,0.0);
 let res=spCacheRes();
 let a=cacheAlpha;
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
struct SpFar{radiance:vec3f,distance:f32,}
/** What lies past the screen and the near scene along \`d\` from \`P\`, of a cone \`size\` texels of the probe's grid a side. */
fn spFarOf(P:vec3f,d:vec3f,size:f32)->SpFar{
 if(spFlag(SP_FLAG_CACHE)&&spCacheCovers()){
  let s=spCacheSample(P,d,size);
  return SpFar(s.radiance,select(s.distance,spMaxTrace(),s.distance>=CACHE_MAX_HIT));
 }
 return SpFar(reflectionEnvironment(d),spMaxTrace());
}`,
  )
