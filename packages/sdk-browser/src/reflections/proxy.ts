import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_SCENE_BINDINGS, reflectionBindingsWgsl } from './viewLayout.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_DITHER_WGSL } from './sampleWgsl.ts'
import { runtimeRadianceWgsl } from '../bounce/runtimeRadianceWgsl.ts'

/**
 * The proxy's answer to a reflection (`reflectionProxied`), where the screen does not give one: the engine's
 * one coarse geometry of the scene (`bounce/runtimeSceneWgsl.ts`), compiled meshes and the cuts the world made at
 * run time alike, the radiance of its surfaces lit where the ray lands (`rtRadiance`). One ray a call, cast this
 * image, kept nowhere: every program that reads the chain — the reflections' trace (`trace.ts`) and the
 * forward fragments alike — calls it once a lobe whose screen answer it did not take, over the
 * reflection group's proxy (`REFLECTION_SCENE_BINDINGS`). The ray leaves the surface the proxy's certified error off its
 * normal (its header's `error`), so that it never meets the proxy's own copy of the surface it leaves, and
 * goes as far as the eye can tell its answer from the field's (`reflectionProxyReach`, `reach.ts`) — no ray
 * where that is under the lift —, and never past `bound`, the surface the screen met on its way, which
 * stops it. It walks `REFLECTION_PROXY_WORK` units at most, on every image: a miss costs that, whatever
 * the scene. Its
 * confidence comes from the hit alone: the share of the ray the surfaces met stop, its distance the first
 * surface's from `P`. Zero where it hits nothing, or where the scene has no proxy.
 */
export const reflectionProxyWgsl = (group: number) =>
  wgslBlock(
    `reflectionProxyWgsl(${group})`,
    [
      reflectionBindingsWgsl(group),
      REFLECTION_LOBE_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_REACH_WGSL,
      REFLECTION_DITHER_WGSL,
      runtimeRadianceWgsl({ ...REFLECTION_SCENE_BINDINGS, group }),
    ],
    `fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe,pixel:f32,width:f32,bound:f32)->RadianceAnswer{
 if(rtProxy.instances==0u){return RadianceAnswer(vec3f(0.0),0.0,0.0);}
 let reach=reflectionProxyReach(P,N,width,reflectionConeTangent(width),pixel);
 let lift=rtProxy.error;
 if(reach<=lift){return RadianceAnswer(vec3f(0.0),0.0,0.0);}
 let tangent=reflectionReadTangent(lobe);
 // Where the field takes over (a reach short of the scene's), a hit over the last stretch of the ray
 // stands less and less often, the field answering the rest: the ray's end is drawn there once, by
 // the inverse of that fade, so a ray pays one answer — its hit's light or the field's gather —,
 // never both, and never a line where the two sources meet.
 var rayEnd=reach;
 if(reach<reflectionSceneReach()){
  let fade=0.5-sin(asin(2.0*reflectionDither(P,lobe.R,1u)-1.0)/3.0);
  rayEnd=mix(REFLECTION_REACH_FADE*reach,reach,fade);
 }
 // Never past the surface the screen met, its slab and the proxy's error on either side of it.
 let far=min(rayEnd,bound+2.0*lift);
 if(far<=lift){return RadianceAnswer(vec3f(0.0),0.0,0.0);}
 var seen=rtRadiance(P+N*lift,lobe.R,far-lift,tangent,REFLECTION_PROXY_WORK);
 seen.distance+=lift;
 return seen;
}`,
  )
