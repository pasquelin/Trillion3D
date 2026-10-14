import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_CONE_WGSL } from './footprint.ts'
import { reflectionBindingsWgsl } from './viewLayout.ts'
import { runtimeAnswerWgsl, type RuntimeBindings } from '../bounce/runtimeAnswerWgsl.ts'
import { sceneKey } from '../bounce/sceneBindings.ts'

/** What names a fragment of a program over `runtime`: its bindings, and the store it keeps its answers in. */
export const proxyKey = (runtime: RuntimeBindings) =>
  `${sceneKey(runtime)}, ${runtime.list}, ${runtime.store}`

/**
 * The proxy's answer to a reflection (`reflectionProxied`), where the screen does not give one: the engine's
 * one coarse geometry of the scene (`bounce/runtimeSceneWgsl.ts`), compiled meshes and the cuts the world made at
 * run time alike, the radiance of its surfaces lit where the ray lands (`rtRadiance`). The ray leaves the surface
 * a certified error of the proxy off its normal (`ReflectionView.proxy`), so that it never meets the proxy's own
 * copy of the surface it leaves. Its confidence comes from the hit alone, for every width of the lobe, a
 * mirror's included: the share of the ray the surfaces met stop. Zero where it hits nothing, or where the scene
 * has no proxy. The trace keeps each pixel's answer, on each of its surfaces — the opaque one and the
 * transparents' front one (`frontLayer.ts`) —, from image to image within its frame's budget (`rtAnswer`,
 * `bounce/runtimeAnswerWgsl.ts`): no other program casts a ray of the proxy.
 */
export const reflectionProxyWgsl = (group: number, runtime: RuntimeBindings) =>
  wgslBlock(
    `reflectionProxyWgsl(${group}, ${proxyKey(runtime)})`,
    [
      reflectionBindingsWgsl(group),
      REFLECTION_LOBE_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_CONE_WGSL,
      runtimeAnswerWgsl(runtime),
    ],
    `struct ReflectionProxied{color:vec3f,confidence:f32,}
fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionProxied{
 let tangent=max(reflectionConeTangent(lobe.widths.x),reflectionConeTangent(lobe.widths.y)/REFLECTION_TAPS);
 let seen=rtAnswer(P+N*max(reflectionView.proxy.x,rtProxy.error),lobe.R,REFLECTION_FAR,tangent);
 return ReflectionProxied(seen.color,seen.confidence);
}`,
  )
