import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bilinear3 } from '../../../../../math/src/wgsl/sampling.ts'
import { octWrapBorder } from '../../../../../math/src/wgsl/octahedral.ts'
import { unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { REFLECTION_ENVIRONMENT_WGSL } from '../../reflections/field.ts'
import { CACHE_WORDS_WGSL, cacheTagsWgsl } from '../cache/cacheWordsWgsl.ts'

/**
 * THE RADIANCE CACHE AS A SCREEN PROBE READS IT: the light the world's probes hold along a direction, interpolated between the
 * eight probes round the point (`spCacheSample`), their final maps `sp.cache.y` texels a side read at `cacheFinal`, the distances their
 * rays went at `cacheRaw`, the cells their maps were made for at `cacheTags`. The caller names the three bindings.
 *
 * The workgroup of a probe finds the eight probes once (`spCacheGather`, a lane each, the caller's barrier after): the level that
 * covers the probe's point (`cacheCoverage`; none, `spCacheCovers` false, and the caller reads the sky), the probes of the
 * eight cells round it and their places — a probe that holds the cell and whose map was made for it, else none, which gives no light and no
 * distance —, and the weights of the interpolation, the fractions of the point in its cell. A ray then reads each probe by
 * a direction moved onto the sphere round it of radius `sp.cache.x` times the nearest a ray of its probe starts
 * (`spCacheProbe`: the far root of the ray against the sphere, the direction from the probe to that point, the light scaled by
 * `t² / (radius · direction·ray)` so that moving toward a texel does not brighten it), its map's four texels round the direction
 * (bilinear, the border wrapped as an octahedron's) and the distance of its nearest texel's ray. `spFarOf` is a ray's answer past
 * the screen and the near scene: the cache's, with the distance it reads where it holds one and the ray's reach where the ray
 * went further than a half float holds; the environment's, at the ray's reach, where the cache covers no point of it.
 */
export const spCacheRead = (final: number, raw: number, tags: number) =>
  wgslBlock(
    `spCacheRead(${final}, ${raw}, ${tags})`,
    [
      CACHE_WORDS_WGSL,
      cacheTagsWgsl(tags, false),
      unpackLight,
      bilinear3,
      octWrapBorder,
      REFLECTION_ENVIRONMENT_WGSL,
    ],
    `@group(0) @binding(${final}) var cacheFinal:texture_2d<u32>;
@group(0) @binding(${raw}) var cacheRaw:texture_2d<u32>;
struct CacheSample{radiance:vec3f,distance:f32,}
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
/** The light of the map at \`tile\` along the point \`uv\` of the square: its four texels round it, bilinear. */
fn spCacheRadiance(tile:vec2u,uv:vec2f,res:u32)->vec3f{
 let q=uv*f32(res)-vec2f(0.5);
 let base=vec2i(floor(q));
 var taps=array<vec3f,4>();
 for(var i=0u;i<4u;i++){
  let texel=vec2u(base+vec2i(i32(i&1u),i32(i>>1u))+vec2i(1));
  taps[i]=unpackLight(textureLoad(cacheFinal,vec2i(tile+octWrapBorder(texel,res+2u,1u)),0).r);
 }
 return bilinear3(taps[0],taps[1],taps[2],taps[3],q-floor(q));
}
/** What the probe at corner \`i\` gives along the ray \`d\` from \`P\`: nothing where it holds no map. */
fn spCacheProbe(i:u32,P:vec3f,d:vec3f,res:u32)->CacheSample{
 let slot=cacheCorner[i];
 if(slot==0u){return CacheSample(vec3f(0.0),0.0);}
 let radius=sp.cache.x*cacheMinTrace(cacheLevelHeld-1u);
 let local=P-cachePlace[i];
 let b=dot(d,local);
 let reach=b*b-(dot(local,local)-radius*radius);
 let t=select(-1.0,sqrt(max(reach,0.0))-b,reach>=0.0);
 let towards=local+d*t;
 let correction=t*t/(radius*dot(towards,d));
 let uv=equalAreaEncode(towards);
 let tile=cacheTileOf(slot-1u,res);
 let word=textureLoad(cacheRaw,vec2i(tile+min(vec2u(uv*f32(res)),vec2u(res-1u))),0).g;
 return CacheSample(spCacheRadiance(tile,uv,res)*correction,cacheDepthOf(word));
}
/** The cache's light and distance along the ray \`d\` from the point \`P\` the workgroup gathered for: the eight probes' weighed by
 *  the fractions of the point in its cell. */
fn spCacheSample(P:vec3f,d:vec3f)->CacheSample{
 var out=CacheSample(vec3f(0.0),0.0);
 let res=spCacheRes();
 let a=cacheAlpha;
 for(var i=0u;i<8u;i++){
  let share=mix(vec3f(1.0)-a,a,vec3f(f32(i&1u),f32((i>>1u)&1u),f32((i>>2u)&1u)));
  let weight=share.x*share.y*share.z;
  let s=spCacheProbe(i,P,d,res);
  out.radiance+=s.radiance*weight;
  out.distance+=s.distance*weight;
 }
 return out;
}
struct SpFar{radiance:vec3f,distance:f32,}
/** What lies past the screen and the near scene along \`d\` from \`P\`. */
fn spFarOf(P:vec3f,d:vec3f)->SpFar{
 if(spFlag(SP_FLAG_CACHE)&&spCacheCovers()){
  let s=spCacheSample(P,d);
  return SpFar(s.radiance,select(s.distance,spMaxTrace(),s.distance>=CACHE_MAX_HIT));
 }
 return SpFar(reflectionEnvironment(d,0.0),spMaxTrace());
}`,
  )
