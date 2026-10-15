import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { reflectionBindingsWgsl } from './viewLayout.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { runtimeRadianceWgsl } from '../bounce/runtimeRadianceWgsl.ts'
import { sceneKey, type SceneBindings } from '../bounce/sceneBindings.ts'

/**
 * The proxy's answer to a reflection (`reflectionProxied`), where the screen does not give one: the engine's
 * one coarse geometry of the scene (`bounce/runtimeSceneWgsl.ts`), compiled meshes and the cuts the world made at
 * run time alike, the radiance of its surfaces lit where the ray lands (`rtRadiance`). One ray a call, cast this
 * image, kept nowhere: the reflections' trace (`trace.ts`) calls it once a lobe of each reflecting
 * pixel whose screen answer it did not take. The ray leaves the surface the proxy's certified error off its
 * normal (its header's `error`), so that it never meets the proxy's own copy of the surface it leaves, and
 * goes as far as the eye can tell its answer from the field's (`reflectionProxyReach`, `reach.ts`) — no ray
 * where that is under the lift —, and never past `bound`, the surface the screen met on its way, which
 * stops it. It walks `REFLECTION_PROXY_WORK` units at most, on every image: a miss costs that, whatever
 * the scene. Its
 * confidence comes from the hit alone: the share of the ray the surfaces met stop, its distance the first
 * surface's from `P`. Zero where it hits nothing, or where the scene has no proxy.
 */
export const reflectionProxyWgsl = (group: number, scene: SceneBindings) =>
  wgslBlock(
    `reflectionProxyWgsl(${group}, ${sceneKey(scene)})`,
    [
      reflectionBindingsWgsl(group),
      REFLECTION_LOBE_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_REACH_WGSL,
      runtimeRadianceWgsl(scene),
    ],
    `fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe,pixel:f32,width:f32,bound:f32)->RadianceAnswer{
 if(rtProxy.instances==0u){return RadianceAnswer(vec3f(0.0),0.0,0.0);}
 let reach=reflectionProxyReach(P,N,width,reflectionConeTangent(width),pixel);
 let lift=rtProxy.error;
 if(reach<=lift){return RadianceAnswer(vec3f(0.0),0.0,0.0);}
 let tangent=reflectionReadTangent(lobe);
 // Never past the surface the screen met, its slab and the proxy's error on either side of it.
 let far=min(reach,bound+2.0*lift);
 var seen=rtRadiance(P+N*lift,lobe.R,far-lift,tangent,REFLECTION_PROXY_WORK);
 seen.distance+=lift;
 // Where the field takes over (a reach short of the scene's), the proxy's answer fades into it over the
 // last stretch of the ray: a body at the reach's end is never a line where the two sources meet.
 if(reach<reflectionSceneReach()){
  seen.confidence*=1.0-smoothstep(REFLECTION_REACH_FADE*reach,reach,seen.distance);
 }
 return seen;
}`,
  )
