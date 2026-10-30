import { TOON_TABLES_NONE_WGSL } from '../../toon/tablesWgsl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { withLightAtlasEntry, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { directLightWgsl } from '../../direct/lightWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../../direct/lobesWgsl.ts'
import { atlasEntry } from '../../bounce/atlas.ts'
import { bounceBindingsWgsl } from '../../bounce/gridWgsl.ts'
import { spCacheRead } from '../../bounce/screen/cacheReadWgsl.ts'
import { spCommon } from '../../bounce/screen/commonWgsl.ts'
import { bindingTable } from '../../bounce/screen/screenProbeLayout.ts'
import { REFLECTION_SIDE } from '../constants.ts'
import { REFLECTION_CLAMP_WGSL } from '../field.ts'
import { reflectionFogWgsl, REFLECTION_SKYLIGHT_LEAK_WGSL } from '../rayLightWgsl.ts'
import { REFLECTION_STORED_RAY_WGSL } from '../storedRayWgsl.ts'
import { REFLECTION_SURFACES_WGSL } from '../surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from '../texelWgsl.ts'
import { REFLECTION_TILES_WGSL, REFLECTION_TRACE_BINDINGS as B } from '../trace/traceBindings.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from '../viewLayout.ts'

/** The radiance cache's bindings in group 0, beside the trace's (`REFLECTION_TRACE_BINDINGS`): the screen probes' parameters, the cascades' uniform and
 *  table, the final maps, the raw ones' distances and the sky's share. */
export const RADIANCE_CACHE_BINDINGS = bindingTable({
  params: [62, 'uniform'],
  bounceGrid: [63, 'uniform'],
  cacheFinal: [65, 'uint'],
  cacheRaw: [66, 'uint'],
  cacheSky: [67, 'float'],
})
/** The cascades' table, a texture array. */
export const RADIANCE_CACHE_PROBES = 64
const C = RADIANCE_CACHE_BINDINGS.at

/** The cache's entries of group 0, the final maps read in the format `light` stores them in. */
export const radianceCacheEntries = (light: LightAtlasFormat) => [
  ...withLightAtlasEntry(RADIANCE_CACHE_BINDINGS.entries, C.cacheFinal, light),
  atlasEntry(RADIANCE_CACHE_PROBES),
]

/**
 * THE RADIANCE CACHE'S COVERAGE OF A POINT (`reflectionCacheCovered`): the level that covers it (`cacheCoverage`, the number its fade is
 * compared with drawn by the caller) when all eight probes round the point hold a map, else none; with the distance the cache asks to be traced
 * before it is read. `reflectionStochasticProbe`: of the eight probes the cache gathered for the point (`cacheNow`), the one a number in [0, 1] picks by
 * the weights of the interpolation, in the order of their sums, the others left out and the point set on the one chosen, so that the read that follows
 * gives its map alone.
 */
const COVERAGE_WGSL = wgslBlock(
  'RADIANCE_CACHE_COVERAGE_WGSL',
  [],
  `fn reflectionCacheCovered(P:vec3f,random:f32)->CacheCoverage{
 let cover=cacheCoverage(P,random);
 if(!cover.valid){return cover;}
 let bottom=probeBottomCell(cover.level,P);
 var held=true;
 for(var lane=0u;lane<8u;lane++){
  let cell=bottom+vec3i(vec3u(lane&1u,(lane>>1u)&1u,(lane>>2u)&1u));
  if(cacheSlotOf(cover.level,cell)==0u){held=false;}
 }
 return CacheCoverage(cover.level,held,cover.minTrace);
}
fn reflectionStochasticProbe(random:f32){
 let a=cacheNow.alpha;
 var sum=0.0;
 var pick=7u;
 for(var lane=0u;lane<8u;lane++){
  let share=mix(vec3f(1.0)-a,a,vec3f(f32(lane&1u),f32((lane>>1u)&1u),f32((lane>>2u)&1u)));
  let weight=share.x*share.y*share.z;
  sum+=weight;
  if(random<=sum&&weight>0.0){pick=lane;break;}
 }
 for(var lane=0u;lane<8u;lane++){
  if(lane!=pick){cacheNow.corner[lane]=0u;}
 }
 cacheNow.alpha=vec3f(f32(pick&1u),f32((pick>>1u)&1u),f32((pick>>2u)&1u));
}`,
)

/**
 * THE TWO KERNELS OF THE REFLECTIONS' RADIANCE CACHE (`reflectionRadianceCache`), each a thread a grid texel of a tracing tile of the opaque surface:
 *
 * - `cacheLimits`, after the ray generation, before the screen stage: a texel that casts a ray whose roughness, plus a blue noise of
 *   `ReflectionView.cache.z`, passes `cache.x` and whose point the cache covers (`reflectionCacheCovered`, noise `interleavedGradientNoise` of the texel
 *   at the frame modulo eight) gets a shortened ray: `cacheTrace.x` metres at that roughness to `cacheTrace.y` at `cache.y`, by the linear step between them, never under the
 *   distance the coverage asks to be traced before the cache is read, never over the longest ray. Stored in the ray's distance layer
 *   (`REFLECTION_RAY_DISTANCE`): negative where the ray is also to read the cache past it, which it is while it is shorter than the longest ray by more than
 *   a hundredth;
 * - `cacheReads`, after the scene stage: a ray marked as having met nothing within its distance (the scene stage sets the distance's lowest bit) takes the light the
 *   cache holds along it from its point, through a cone of its angle (the mip of the maps the cone's width in texels names, `1 / sqrt(1 - cos)` cones across the
 *   octahedron), from one probe drawn at one half (`cacheTrace.z`) or from the eight, with the sky light's leaking added, the height fog over the distance it went, the ceiling
 *   of a ray, and is written as the fresh texel with that distance as its hit.
 */
const KERNELS_WGSL = `fn cacheLimitsTexel(g:vec2u){
 let texel=vec2i(g);
 if(!reflectionRayTraces(bitcast<f32>(textureLoad(surfaceRays,texel,REFLECTION_RAY_DEPTH).r))){return;}
 let coord=vec2i(reflectionPickedPixel(g));
 let own=reflectingPixelAt(REFLECTION_LAYER,coord,surfaceFlagsAt(coord));
 let bounds=reflectionView.cache;
 let rough=own.top+blueNoiseScalar(g,reflectionView.temporal.x)*bounds.z;
 if(rough<=bounds.x){return;}
 let cover=reflectionCacheCovered(own.P,interleavedGradientNoise(vec2f(g),f32(reflectionView.temporal.z%8u)));
 if(!cover.valid){return;}
 let far=reflectionView.march.w;
 let alpha=saturate((rough-bounds.x)/(bounds.y-bounds.x));
 let reach=min(max(mix(reflectionView.cacheTrace.x,reflectionView.cacheTrace.y,alpha),cover.minTrace),far);
 textureStore(surfaceRays,texel,REFLECTION_RAY_DISTANCE,vec4u(bitcast<u32>(select(reach,-reach,reach<far*0.99)),0u,0u,0u));
}
fn cacheReadsTexel(g:vec2u){
 let texel=vec2i(g);
 if(!reflectionRayTraces(bitcast<f32>(textureLoad(surfaceRays,texel,REFLECTION_RAY_DEPTH).r))){return;}
 let kept=textureLoad(surfaceRays,texel,REFLECTION_RAY_DISTANCE).r;
 if((kept&0x80000001u)!=0x80000001u){return;}
 let stored=reflectionStoredRay(texel);
 let reach=reflectionLimit;
 let coord=vec2i(reflectionPickedPixel(g));
 let own=reflectingPixelAt(REFLECTION_LAYER,coord,surfaceFlagsAt(coord));
 let R=stored.ray.R;
 spCacheGatherOwnBiased(own.P,0u,interleavedGradientNoise(vec2f(g),f32(reflectionView.temporal.z%8u)));
 if(reflectionView.cacheTrace.z!=0.0){reflectionStochasticProbe(0.5);}
 let size=1.0/sqrt(max(1.0-cos(stored.cone),1e-6));
 let far=spFarOf(own.P,R,size);
 let lit=far.radiance+reflectionSkylightLeak(vec3f(0.0));
 textureStore(traceOut,texel,freshPack(reflectionClampRay(reflectionFogged(lit,own.P,R*reach)),reach));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn cacheLimits(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let id=reflectionTileOrigin(t)+local.xy;
 if(all(id<reflectionGridSize())){cacheLimitsTexel(id);}
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn cacheReads(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let id=reflectionTileOrigin(t)+local.xy;
 if(all(id<reflectionGridSize())){cacheReadsTexel(id);}
}`

/** The program of the two kernels, the cache's final maps read in the format `light` stores them in. */
export const radianceCacheProgram = (light: LightAtlasFormat) =>
  wgslProgram(
    `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.traceOut}) var traceOut:texture_storage_2d<rg32uint,write>;
@group(0) @binding(${C.params}) var<uniform> spBase:ScreenProbeParams;
var<private> sp:ScreenProbeParams;
${KERNELS_WGSL}`,
    [
      directLightWgsl(),
      LOBES_LIGHTING_WGSL,
      // Toon pixels are not lit here: the tables the toon code reads answer zero.
      TOON_TABLES_NONE_WGSL,
      LOBES_DECODE_WGSL,
      reflectionLightViewWgsl(REFLECTION_GROUP),
      spCommon([1, 1]),
      bounceBindingsWgsl(0, C.bounceGrid, RADIANCE_CACHE_PROBES),
      spCacheRead(C.cacheFinal, C.cacheRaw, C.cacheSky, 'private', light),
      COVERAGE_WGSL,
      interleavedGradientNoise,
      blueNoiseWgsl(0, B.blue, true),
      REFLECTION_SURFACES_WGSL,
      REFLECTION_STORED_RAY_WGSL,
      REFLECTION_TILES_WGSL,
      REFLECTION_TEXEL_WGSL,
      REFLECTION_CLAMP_WGSL,
      REFLECTION_SKYLIGHT_LEAK_WGSL,
      reflectionFogWgsl(B.fogCubemap, B.fogSampler),
    ],
  )
