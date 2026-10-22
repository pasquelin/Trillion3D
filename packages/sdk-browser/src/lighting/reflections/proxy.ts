import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { runtimeRadianceWgsl } from '../bounce/runtime/runtimeRadianceWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_PROXY_BINDINGS } from './trace/traceBindings.ts'

/**
 * The proxy's answer to a reflection (`reflectionProxied`), where the screen did not give one: the engine's
 * one coarse geometry of the scene (`../bounce/runtime/runtimeSceneWgsl.ts`), compiled meshes and the cuts the world
 * made at run time alike, the radiance of its surfaces lit where the ray lands (`rtRadiance`), by the light the
 * probes hold there and no more (`indirectHeld`). One ray a call, cast this image, kept nowhere, by the trace's scene stage alone (`trace/trace.ts`), for a pixel in the
 * near field (`reflectionNearField`, `reach.ts`: the scene tier of the reflections' levels of
 * precision), over its own group's proxy (`REFLECTION_PROXY_BINDINGS`). The ray leaves the surface the proxy's certified error off its normal
 * (its header's `error`), so that it never meets the proxy's own copy of the surface it leaves, goes no
 * further than `bound`, the surface the screen met on its way, nor than the scene's edge
 * (`reflectionSceneReach`, `reach.ts`), and walks `REFLECTION_PROXY_WORK` units at most: a miss costs
 * that, whatever the scene. Its confidence comes from the hit alone: the share of the ray the surfaces met
 * stop, its distance the first surface's from `P`; zero where it hits nothing, or where the scene has no
 * proxy. `open`: the share of the ray that went through every surface it met to the scene's edge
 * within its units (`RtWalk.open`), which leaves the scene — the environment's alone, no probe stands
 * in the way —; none for a ray cut by `bound`, out of units, stopped on its layers or with no proxy to
 * walk; what a hit stops without being known (a deformed body's) is neither, and the field answers it.
 */
export const REFLECTION_PROXY_WGSL = wgslBlock(
  'REFLECTION_PROXY_WGSL',
  [
    REFLECTION_LOBE_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    REFLECTION_REACH_WGSL,
    runtimeRadianceWgsl(REFLECTION_PROXY_BINDINGS),
  ],
  `struct ReflectionProxied{answer:RadianceAnswer,open:f32,}
fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe,bound:f32)->ReflectionProxied{
 let none=ReflectionProxied(RadianceAnswer(vec3f(0.0),0.0,0.0),0.0);
 if(rtProxy.instances==0u){return none;}
 let lift=rtProxy.error;
 let edge=reflectionSceneReach();
 // Never past the surface the screen met, its slab and the proxy's error on either side of it.
 let far=min(edge,bound+2.0*lift);
 if(far<=lift){return none;}
 var walk=rtLayers(P+N*lift,lobe.R,far-lift,reflectionReadTangent(lobe),REFLECTION_PROXY_WORK,RT_TRIANGLES,false);
 walk.answer.distance+=lift;
 return ReflectionProxied(walk.answer,select(0.0,walk.open,far>=edge));
}`,
)
