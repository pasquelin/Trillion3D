import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { BOUNCE_TRACE_WGSL } from '../bounce/traceWgsl.ts'
import { SURFACE_RAY_WGSL } from '../bounce/surfaceRayWgsl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './footprint.ts'
import { reflectionBindingsWgsl } from './viewLayout.ts'
import { runtimeTraceWgsl, type RuntimeBindings } from '../bounce/runtimeTraceWgsl.ts'

/**
 * The proxy's answer to a reflection (`reflectionProxied`), where the screen does not give one: the
 * resident proxy the bounce traces, the engine's one coarse geometry of the whole scene, its
 * surfaces' radiance the cache holds (`rayRadiance`, `bounce/surfaceRayWgsl.ts`). The ray leaves
 * the surface a certified error of the proxy off its normal (`ReflectionView.proxy`), so that it
 * never meets the proxy's own copy of the surface it leaves. Its confidence comes from the hit
 * alone, for every width of the lobe, a mirror's included: the radiance of the surface the ray
 * meets, whole up to half the ray's reach and fading to zero at it, so that a surface just past the
 * reach is the next stage's, never a step. Zero where it hits nothing, or where the scene has no
 * proxy.
 */
export const reflectionProxyWgsl = (group: number, runtime?: RuntimeBindings) =>
  wgslBlock(
    `reflectionProxyWgsl(${group}, ${runtime ? 'runtime' : 'cooked'})`,
    [
      reflectionBindingsWgsl(group),
      REFLECTION_LOBE_WGSL,
      BOUNCE_TRACE_WGSL,
      SURFACE_RAY_WGSL,
      ...(runtime
        ? [REFLECTION_CONSTANTS_WGSL, REFLECTION_CONE_WGSL, runtimeTraceWgsl(runtime)]
        : []),
    ],
    `struct ReflectionProxied{color:vec3f,confidence:f32,}
fn reflectionCooked(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionProxied{
 if(proxyNodeCount()==0u){return ReflectionProxied(vec3f(0.0),0.0);}
 let reach=bounce.reach.x;
 let hit=rayRadiance(P+N*reflectionView.proxy.x,lobe.R,reach);
 if(!(hit.w<reach)){return ReflectionProxied(vec3f(0.0),0.0);}
 return ReflectionProxied(hit.rgb,1.0-smoothstep(0.5*reach,reach,hit.w));
}${
      runtime
        ? `
/** The cooked proxy's answer, then the run-time proxy's on the share it left (\`rtAnswer\`): the two
 *  mixed by the shares each holds, the confidence what both hold. */
fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionProxied{
 let cooked=reflectionCooked(P,N,lobe);
 let tangent=max(reflectionConeTangent(lobe.widths.x),reflectionConeTangent(lobe.widths.y)/REFLECTION_TAPS);
 let seen=rtAnswer(P+N*max(reflectionView.proxy.x,rtProxy.error),lobe.R,REFLECTION_FAR,tangent);
 let share=seen.confidence*(1.0-cooked.confidence);
 let held=cooked.confidence+share;
 if(held<=0.0){return ReflectionProxied(vec3f(0.0),0.0);}
 return ReflectionProxied((cooked.color*cooked.confidence+seen.color*share)/held,held);
}`
        : `
fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionProxied{return reflectionCooked(P,N,lobe);}`
    }`,
  )
