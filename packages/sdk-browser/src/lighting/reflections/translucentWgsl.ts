import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { makeFinite3 } from '../../../../math/src/wgsl/integer.ts'
import {
  ndcToPixel,
  pixelToNdc,
  screenEdgeVignette,
  slabPerspective,
} from '../../../../math/src/wgsl/projection.ts'
import { bilinear3, interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { bounceBindingsWgsl } from '../bounce/gridWgsl.ts'
import { spCacheRead } from '../bounce/screen/cacheReadWgsl.ts'
import { spCommon } from '../bounce/screen/commonWgsl.ts'
import { SP_FIXED_TOLERANCE } from '../bounce/screen/traceFeatureWgsl.ts'
import {
  SS_FURTHEST_WGSL,
  SS_RAY_OF_CLIP_WGSL,
  castFunctionWgsl,
} from '../screenSpaceTracing/rayCastWgsl.ts'
import {
  COVERAGE_WGSL,
  RADIANCE_CACHE_BINDINGS,
  RADIANCE_CACHE_PROBES,
} from './radianceCache/wgsl.ts'

/** The steps of the march of the last lit image a translucent surface looks at, and the factor of its tolerance on the slope of the ray (a 4 in a perspective view). */
const SCREEN_STEPS = 12
const SLOPE_TOLERANCE = 4

/**
 * WHAT A TRANSLUCENT SURFACE REFLECTS OF THE SCENE (`forwardScene`), in the fragment stage of the blends, the water and the transmissive stages, along the mirror
 * direction `R = 2 (V·N) N − V` of the fragment's point `P` (its roughness changes neither the direction nor the width of what is read of the cache). Its resources are the
 * reflection group's, widened (`reflectionForwardLayout`): the depth pyramid, the last lit image, and the radiance cache's (`RADIANCE_CACHE_BINDINGS`, the screen probes'
 * parameters `spBase` copied to the fragment's own `sp`).
 *
 * In order:
 * - `translucentCache`: where the cache covers `P` (`reflectionCacheCovered`, its level chosen by a fixed half, all eight probes
 *   round the point holding a map), the light the cache holds along `R` through a cone of no width, one probe of the eight drawn at one half (`reflectionStochasticProbe`);
 *   elsewhere, or where the setting is off (`ReflectionView.translucent.y`), the environment through the lobe (`reflectionEnvironmentOf`);
 * - `translucentScreen`: unless the view was cut since the last lit image (`ReflectionView.traced.x`) or the quality is 0 (`translucent.x`), a march of the depth pyramid
 *   along `R` (`translucentScreenRay`: the ray from `P` over at most the fragment's depth, stopped short of the eye plane and extended to the border of the screen, its
 *   tolerance on the slope `SLOPE_TOLERANCE`; `ssCast` in `SCREEN_STEPS` steps, the first moved by the interleaved gradient noise of the fragment's pixel at the
 *   image's turn less a half (`ReflectionView.temporal.y`), rougher surfaces looking at coarser levels) whose hit
 *   takes the last lit image where the hit stood in it (the last view-projection, the image's pixel read bilinear, held inside its border), faded at the border of both
 *   images and by `saturate(2 − 6.6 · rough)`, taken out of the pre-exposure it was lit with. The answer above is kept by what the hit's alpha leaves of it:
 *   `answer · (1 − alpha) + hit`. The march reads the pyramid as the image drew it, the nearest transparent surface folded in (`HIZ_FOLD_WGSL`); a hit is kept only where
 *   the opaque depth of its pixel (`hizOpaqueDepth`, one load, on hits only) lies within the ray's tolerance, so that a pane never reflects itself.
 *
 * The march's start is dithered per pixel as the reference's is: without it every pixel of a pane crosses an edge of the reflected scene at the same step, and the
 * edge comes back as stairs of one step's length. A view held still keeps its dither (`noiseFrame`): a grain of one pixel, not stairs. The cache's level is
 * chosen by the mean of the noise (`TRANSLUCENT_COVERAGE_RANDOM`).
 *
 * Inherited gap: the cache covers a point only where all eight probes round it hold a map (`reflectionCacheCovered`, as the opaque rough reflections' read does), where the
 * coverage of its level alone would answer; a point at the edge of the probes made falls back to the environment.
 */
export const translucentReflectionWgsl = (group: number, light: LightAtlasFormat) => {
  const C = RADIANCE_CACHE_BINDINGS.at
  return wgslBlock(
    `translucentReflectionWgsl(${group}, ${light})`,
    [
      spCommon([1, 1]),
      bounceBindingsWgsl(group, C.bounceGrid, RADIANCE_CACHE_PROBES),
      spCacheRead(C.cacheFinal, C.cacheRaw, C.cacheSky, 'private', light, group),
      COVERAGE_WGSL,
      castFunctionWgsl(false),
      SS_FURTHEST_WGSL,
      SS_RAY_OF_CLIP_WGSL,
      SP_FIXED_TOLERANCE,
      bilinear3,
      interleavedGradientNoise,
      makeFinite3,
      ndcToPixel,
      pixelToNdc,
      screenEdgeVignette,
      slabPerspective,
    ],
    `@group(${group}) @binding(${C.params}) var<uniform> spBase:ScreenProbeParams;
var<private> sp:ScreenProbeParams;
/** The width of the cone the cache is read through, in texels of a probe's grid a side: that of a cone of half angle zero (1 / sqrt(1 - cos), the cosine's complement held at a millionth). */
const TRANSLUCENT_CONE_SIZE:f32=1000.0;
/** The number the cache's level is chosen with, a half (as the translucency volume's trace chooses it): the mean of the noise a pixel would draw, so that a level answers only while the point lies more than half the fade's width inside its edge. */
const TRANSLUCENT_COVERAGE_RANDOM:f32=0.5;
/** What a read answers, and whether it did. */
struct TranslucentCached{radiance:vec3f,covered:bool,}
fn translucentCache(P:vec3f,R:vec3f,random:f32)->TranslucentCached{
 if(reflectionView.translucent.y==0u){return TranslucentCached(vec3f(0.0),false);}
 if(!reflectionCacheCovered(P,random).valid){return TranslucentCached(vec3f(0.0),false);}
 sp=spBase;
 spCacheGatherOwnBiased(P,0u,random);
 reflectionStochasticProbe(0.5);
 return TranslucentCached(spCacheSample(P,R,TRANSLUCENT_CONE_SIZE).radiance,true);
}
/** The screen ray of a translucent surface from P along R, sceneDepth the fragment's view distance and viewZ the part of R along the view (negative toward the eye). */
fn translucentScreenRay(P:vec3f,R:vec3f,sceneDepth:f32,viewZ:f32)->SsRay{
 let limit=min(sceneDepth,1000000.0);
 let ends=select(limit,min(-0.95*sceneDepth/viewZ,limit),viewZ<0.0);
 let startClip=reflectionView.viewProj*vec4f(P,1.0);
 let endClip=reflectionView.viewProj*vec4f(P+R*ends,1.0);
 let deeper=spFixedDeeper(startClip.z/startClip.w,ends);
 return ssRayOfClip(startClip,endClip,deeper,${SLOPE_TOLERANCE}.0,slabPerspective(reflectionView.slab),true,false);
}
/** The last lit image's light at the pixel q (continuous, in pixels of the image), bilinear, held inside its border. */
fn translucentLastImage(q:vec2f)->vec3f{
 let size=reflectionView.radiance.xy;
 let at=clamp(q,vec2f(0.5),size-vec2f(0.5))-vec2f(0.5);
 let base=vec2i(floor(at));
 let last=vec2i(size)-vec2i(1);
 var taps=array<vec3f,4>();
 for(var i=0;i<4;i++){
  let texel=clamp(base+vec2i(i&1,i>>1),vec2i(0),last);
  taps[i]=max(makeFinite3(textureLoad(reflectionImage,texel,0).rgb),vec3f(0.0));
 }
 return bilinear3(taps[0],taps[1],taps[2],taps[3],at-floor(at));
}
/** What the march of the last lit image gives: its light with the share of the answer it replaces in its w component, none for a ray that hit nothing. */
fn translucentScreen(P:vec3f,R:vec3f,rough:f32,pixel:vec2f)->vec4f{
 if(reflectionView.translucent.x==0u||reflectionView.traced.x==0u){return vec4f(0.0);}
 let sceneDepth=spDepthOf(P);
 let viewZ=select(dot(R,-normalize(view.camera.xyz)),(reflectionView.viewProj*vec4f(R,0.0)).w,slabPerspective(reflectionView.slab));
 let ray=translucentScreenRay(P,R,sceneDepth,viewZ);
 let jitter=interleavedGradientNoise(pixel,f32(reflectionView.temporal.y))-0.5;
 let marched=ssCast(ray,rough,${SCREEN_STEPS}u,jitter,1.0);
 if(!marched.found){return vec4f(0.0);}
 // The pyramid holds the nearest transparent surface folded into the depth: a hit counts only where the opaque depth of its pixel lies within the ray's tolerance.
 if(abs(marched.hit.z-hizOpaqueDepth(vec2i(floor(marched.hit.xy*view.viewport.xy))))>ray.tolerance){return vec4f(0.0);}
 let size=view.viewport.xy;
 let hitPoint=worldAt(marched.hit.xy*size,marched.hit.z);
 let last=reflectionView.radianceViewProj*vec4f(hitPoint,1.0);
 if(last.w<=0.0){return vec4f(0.0);}
 let thisNdc=(marched.hit.xy-vec2f(0.5))*vec2f(2.0,-2.0);
 let lastNdc=last.xy/last.w;
 let share=min(screenEdgeVignette(thisNdc),screenEdgeVignette(lastNdc))*saturate(2.0-6.6*rough);
 let light=translucentLastImage(ndcToPixel(lastNdc,reflectionView.radiance.xy))*reflectionView.radiance.w;
 return vec4f(light*share,share);
}
/** What a translucent surface that is not the traced front reflects of the scene at framebuffer pixel pixel: the cache or the environment, the last lit image over it. */
fn forwardScene(P:vec3f,N:vec3f,V:vec3f,rough:f32,pixel:vec2f)->Reflected{
 let R=2.0*dot(V,N)*N-V;
 let cached=translucentCache(P,R,TRANSLUCENT_COVERAGE_RANDOM);
 var lit=Reflected(cached.radiance,cached.radiance);
 if(!cached.covered){lit=reflectionEnvironmentOf(N,V,rough);}
 let seen=translucentScreen(P,R,rough,pixel);
 return Reflected(lit.base*(1.0-seen.w)+seen.rgb,lit.coat*(1.0-seen.w)+seen.rgb);
}`,
  )
}
