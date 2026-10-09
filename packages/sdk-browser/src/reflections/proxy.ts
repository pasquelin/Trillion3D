import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { BOUNCE_TRACE_WGSL } from '../bounce/traceWgsl.ts'
import { SURFACE_RAY_WGSL } from '../bounce/surfaceRayWgsl.ts'
import { REFLECTION_CONE_WGSL } from './footprint.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { reflectionBindingsWgsl } from './viewLayout.ts'

/**
 * The proxy's answer to a reflection (`reflectionProxied`), where the screen does not give one: the
 * resident proxy the bounce traces, the engine's one coarse geometry of the whole scene, its
 * surfaces' radiance the cache holds (`rayRadiance`, `bounce/surfaceRayWgsl.ts`). The ray leaves
 * the surface a certified error of the proxy off its normal (`ReflectionView.proxy`), so that it
 * never meets the proxy's own copy of the surface it leaves. Its confidence is how far the lobe's
 * cone, at the distance of the hit, covers the proxy's cell: a cone narrower than half a cell reads
 * one flat triangle of it, none of the detail the proxy does not have (zero on a mirror); from a
 * whole cell up the proxy is as fine as the lobe is. Zero where it hits nothing, or where the scene
 * has no proxy.
 */
export const reflectionProxyWgsl = (group: number) =>
  wgslBlock(
    `reflectionProxyWgsl(${group})`,
    [
      reflectionBindingsWgsl(group),
      REFLECTION_LOBE_WGSL,
      REFLECTION_CONE_WGSL,
      BOUNCE_TRACE_WGSL,
      SURFACE_RAY_WGSL,
    ],
    `struct ReflectionProxied{color:vec3f,confidence:f32,}
fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionProxied{
 let cell=reflectionView.proxy.x;
 if(!(cell>0.0)||proxyNodeCount()==0u){return ReflectionProxied(vec3f(0.0),0.0);}
 let reach=bounce.reach.x;
 let hit=rayRadiance(P+N*reflectionView.proxy.y,lobe.R,reach);
 if(!(hit.w<reach)){return ReflectionProxied(vec3f(0.0),0.0);}
 let width=2.0*hit.w*reflectionConeTangent(lobe.widths.x);
 return ReflectionProxied(hit.rgb,smoothstep(0.5*cell,cell,width));
}`,
  )
