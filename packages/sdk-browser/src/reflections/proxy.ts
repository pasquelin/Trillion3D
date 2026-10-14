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
 * image, kept nowhere: the reflections' trace (`traceHalf.ts`) calls it once a lobe of each half-resolution
 * texel. The ray leaves the surface a certified error of the proxy off its normal (`ReflectionView.proxy`), so
 * that it never meets the proxy's own copy of the surface it leaves, and goes as far as the eye can tell its
 * answer from the field's (`reflectionProxyReach`, `reach.ts`): no ray where that is under the lift. Its
 * confidence comes from the hit alone: the share of the ray the surfaces met stop, its distance the first
 * surface's (`rtHitDistance`). Zero where it hits nothing, or where the scene has no proxy.
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
    `struct ReflectionProxied{color:vec3f,confidence:f32,distance:f32,}
fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe,pixel:f32)->ReflectionProxied{
 if(rtProxy.instances==0u){return ReflectionProxied(vec3f(0.0),0.0,0.0);}
 let narrow=min(lobe.widths.x,lobe.widths.y);
 let reach=reflectionProxyReach(P,narrow,min(lobe.tangents.x,lobe.tangents.y),pixel);
 let lift=max(reflectionView.proxy.x,rtProxy.error);
 if(reach<=lift){return ReflectionProxied(vec3f(0.0),0.0,0.0);}
 let tangent=reflectionReadTangent(lobe);
 let seen=rtRadiance(P+N*lift,lobe.R,reach-lift,tangent);
 return ReflectionProxied(seen.color,seen.confidence,lift+rtHitDistance);
}`,
  )
