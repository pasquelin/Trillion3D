import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { rayInverseDirection } from '../../../../math/src/wgsl/geometry.ts'
import { runtimeRadianceWgsl } from '../bounce/runtime/runtimeRadianceWgsl.ts'
import { REFLECTION_FATE_WGSL } from './censusWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_PROXY_BINDINGS } from './trace/traceBindings.ts'

/**
 * The proxy's answer to a reflection (`reflectionProxied`), where the screen did not give one: the engine's
 * one coarse geometry of the scene (`../bounce/runtime/runtimeSceneWgsl.ts`), compiled meshes and the cuts the world
 * made at run time alike, the radiance of its surfaces lit where the ray lands (`rtRadiance`), by the light the
 * probes hold there and no more (`indirectHeld`). One ray a call, cast this image, kept nowhere, by the trace's scene
 * stage alone (`trace/trace.ts`), for a pixel in the near field (`reflectionNearField`, `reach.ts`: the scene tier
 * of the reflections' levels of precision), over its own group's proxy (`REFLECTION_PROXY_BINDINGS`). The ray leaves
 * the surface the proxy's certified error off its normal (its header's `error`), so that it never meets the proxy's
 * own copy of the surface it leaves, goes no further than `bound`, the surface the screen met on its way, nor than
 * the scene's edge (`reflectionSceneReach`, `reach.ts`).
 *
 * THE RINGS. The ray is walked in segments, as many as the cascades' cubes about the eye it crosses (`reach.ts`,
 * `reflectionRings`): from the finest cube that holds its start to the outermost, each ring the ray from the end of
 * the one before to the end of its own cube, cut at the reach. Each ring is one walk of the proxy (`rtLayers`) with a
 * budget of its own — the work and the triangle tests the view holds (`ReflectionView.scene`, the setting
 * `reflectionRingSteps`) —, so that a crowded ring never takes the budget of the rings behind it: the cost of a
 * ray is bounded by its rings, its distance, never by the density of the scene it crosses alone. A ring that meets a
 * surface answers it; a ring that spends its budget has met none: the ray goes on at its end — the unwalked rest of
 * the ring is not seen — and a ray that meets nothing in any ring goes to the environment (`open`), never to a hit
 * it has not found. A surface met in an earlier ring ends the ray unless it lets light through (a blended one), the
 * share that went through going on to the rings behind it. With the scene traces off (`ReflectionView.scene.w`) no
 * ring is walked: the ray goes whole to the environment, as one that meets nothing does.
 *
 * What a ray answers is its first surfaces' radiance and confidence (the share of the ray they stop, `rtLayers`),
 * the distance of the first from `P`; zero where it hits nothing, or where the scene has no proxy. `open`: the share
 * of the ray that went through every surface it met, and every ring it was not walked in, to the scene's edge,
 * which leaves the scene — the environment's alone, no probe stands in the way —; none for a ray cut by `bound`, or
 * with no proxy to walk; what a hit stops without being known (a deformed body's) is neither, and the field
 * answers it. How the rings ended and the units they spent are left in `reflectionFate` and `reflectionWork`
 * (`censusWgsl.ts`), for the trace's census to count.
 */
export const REFLECTION_PROXY_WGSL = wgslBlock(
  'REFLECTION_PROXY_WGSL',
  [
    REFLECTION_LOBE_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    REFLECTION_REACH_WGSL,
    REFLECTION_FATE_WGSL,
    rayInverseDirection,
    runtimeRadianceWgsl(REFLECTION_PROXY_BINDINGS),
  ],
  `struct ReflectionProxied{answer:RadianceAnswer,open:f32,}
/** What the rings of a ray found: the radiance and the share of the ray the surfaces answered (the radiance a
 *  sum, over the share), the distance of the first, the share that went through to the end, what spent the first
 *  ring that was spent (a \`REFLECTION_FATE_*\`, zero where none was) and the units the rings spent. */
struct ReflectionRings{radiance:vec3f,confidence:f32,first:f32,open:f32,spent:u32,work:u32,}
/** How a walk that spent its budget ended, by what spent it (\`rtCause\`, \`RT_CAUSE_*\`). */
fn reflectionSpentFate()->u32{
 if(rtCause==RT_CAUSE_WORK){return REFLECTION_FATE_WORK;}
 if(rtCause==RT_CAUSE_TESTS){return REFLECTION_FATE_TESTS;}
 if(rtCause==RT_CAUSE_TREE){return REFLECTION_FATE_TREE;}
 return REFLECTION_FATE_MESH;
}
/** The ray from \`O\` along \`R\`, \`reach\` far, walked ring by ring: one walk of the proxy a ring, the budget of the
 *  view's each. A ring that is not spent answers what it met and passes the share it let through; one that is
 *  spent passes the ray whole, which goes on at its end; the rings end at the outermost cube, at the reach, or
 *  where nothing is left to go on. */
fn reflectionRings(O:vec3f,R:vec3f,reach:f32,tangent:f32)->ReflectionRings{
 let inverse=rayInverseDirection(R);
 let levels=select(0u,min(bounce.counts.y,CASCADE_LEVELS),bounce.counts.w!=0u);
 var level=reflectionRingFirst(O,levels);
 var rings=ReflectionRings(vec3f(0.0),0.0,reach,1.0,0u,0u);
 var begin=0.0;
 // Scene traces off: no ring is walked, the whole ray goes on to the environment.
 if(reflectionView.scene.w==0u){return rings;}
 for(var ring=0u;ring<=levels;ring++){
  var end=reach;
  if(level<levels){end=min(reflectionRingExit(level,O,inverse),reach);}
  if(end>begin){
   let walk=rtLayers(O+R*begin,R,end-begin,tangent,reflectionView.scene.y,reflectionView.scene.z,false);
   rings.work+=rtWork;
   if(rtSpent()){
    if(rings.spent==0u){rings.spent=reflectionSpentFate();}
   }else{
    let share=rings.open*walk.answer.confidence;
    if(share>0.0&&rings.confidence==0.0){rings.first=begin+walk.answer.distance;}
    rings.radiance+=share*walk.answer.color;
    rings.confidence+=share;
    rings.open*=walk.open;
   }
   begin=end;
  }
  level++;
  if(end>=reach||level>=levels||rings.open<=REFLECTION_EPSILON){break;}
 }
 return rings;
}
/** How the rings ended: a surface hit, else by what spent the first ring that was, else out of the scene or nowhere. */
fn reflectionRingsFate(rings:ReflectionRings,open:f32)->u32{
 if(rings.confidence>0.0){return REFLECTION_FATE_HIT;}
 if(rings.spent!=0u){return rings.spent;}
 return select(REFLECTION_FATE_MISS,REFLECTION_FATE_OPEN,open>0.0);
}
fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe,bound:f32)->ReflectionProxied{
 let none=ReflectionProxied(RadianceAnswer(vec3f(0.0),0.0,0.0),0.0);
 reflectionFate=REFLECTION_FATE_NO_PROXY;
 reflectionWork=0u;
 if(rtProxy.instances==0u){return none;}
 let lift=rtProxy.error;
 let edge=reflectionSceneReach();
 // Never past the surface the screen met, its slab and the proxy's error on either side of it.
 let far=min(edge,bound+2.0*lift);
 if(far<=lift){reflectionFate=REFLECTION_FATE_BOUND;return none;}
 let rings=reflectionRings(P+N*lift,lobe.R,far-lift,reflectionReadTangent(lobe));
 let open=select(0.0,rings.open,far>=edge);
 reflectionWork=rings.work;
 reflectionFate=reflectionRingsFate(rings,open);
 let color=select(vec3f(0.0),rings.radiance/rings.confidence,rings.confidence>0.0);
 return ReflectionProxied(RadianceAnswer(color,rings.confidence,rings.first+lift),open);
}`,
)
