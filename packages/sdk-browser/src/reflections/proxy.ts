import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './footprint.ts'
import { reflectionBindingsWgsl } from './viewLayout.ts'
import {
  runtimeRadianceWgsl,
  runtimeTraceWgsl,
  type RuntimeBindings,
  type SceneBindings,
} from '../bounce/runtimeTraceWgsl.ts'

/** The bindings a program reads the proxy through: with the store the opaque trace keeps its answers in
 *  (`RuntimeBindings`), or the proxy alone (`SceneBindings`), as the forward programs read it. */
export type ProxyBindings = SceneBindings | RuntimeBindings

/**
 * The proxy's answer to a reflection (`reflectionProxied`), where the screen does not give one: the engine's
 * one coarse geometry of the scene (`bounce/runtimeSceneWgsl.ts`), compiled meshes and the cuts the world made at
 * run time alike, the radiance of its surfaces lit where the ray lands (`rtRadiance`). The ray leaves the surface
 * a certified error of the proxy off its normal (`ReflectionView.proxy`), so that it never meets the proxy's own
 * copy of the surface it leaves. Its confidence comes from the hit alone, for every width of the lobe, a
 * mirror's included: the share of the ray the surfaces met stop. Zero where it hits nothing, or where the scene
 * has no proxy. The answer is kept from image to image (`bounce/runtimeAnswerWgsl.ts`).
 */
export const reflectionProxyWgsl = (group: number, runtime: ProxyBindings) => {
  // The opaque trace keeps each pixel's answer from image to image (`rtAnswer`); a forward program casts its
  // fragment's ray, writes nothing (a binding its stage could write would cost the pass its early depth
  // reject) and answers it whole (`rtRadiance`).
  const answers = 'store' in runtime
  return wgslBlock(
    `reflectionProxyWgsl(${group}, ${runtime.proxy}, ${answers})`,
    [
      reflectionBindingsWgsl(group),
      REFLECTION_LOBE_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_CONE_WGSL,
      answers ? runtimeTraceWgsl(runtime) : runtimeRadianceWgsl(runtime),
    ],
    `struct ReflectionProxied{color:vec3f,confidence:f32,}
fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionProxied{
 let tangent=max(reflectionConeTangent(lobe.widths.x),reflectionConeTangent(lobe.widths.y)/REFLECTION_TAPS);
 let seen=${answers ? 'rtAnswer' : 'rtRadiance'}(P+N*max(reflectionView.proxy.x,rtProxy.error),lobe.R,REFLECTION_FAR,tangent);
 return ReflectionProxied(seen.color,seen.confidence);
}`,
  )
}
