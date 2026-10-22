import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { wgslBlock, wgslStruct } from '../../../../../math/src/wgsl/decl.ts'
import { SURFACE_RAY_WGSL } from '../surfaceRayWgsl.ts'
import { NORMAL_TRANSFORM_WGSL } from '../../standardLighting.ts'
import { faceNormal } from '../../../../../math/src/wgsl/geometry.ts'
import { worldMatrix3 } from '../../../../../math/src/wgsl/matrix.ts'
import { markReachWgsl } from '../../../deformation/halfFloat.ts'
import { runtimeSceneWgsl } from './runtimeSceneWgsl.ts'
import { sceneKey, type SceneBindings } from '../sceneBindings.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import {
  RAY_ERROR_FLOOR,
  RAY_LAYERS,
  RAY_SPREAD_FLOOR,
  RAY_THROUGH_FLOOR,
  SURFACE,
  SURFACE_BLENDED,
  SURFACE_WORDS,
} from './runtimeLayout.ts'

/** What a stage of a ray's answer brings back: the radiance of what it met, the confidence of the
 *  answer, and the distance to what answered — the screen's, the proxy's, one struct. */
export const RADIANCE_ANSWER = wgslStruct(
  'RadianceAnswer',
  [],
  'struct RadianceAnswer{color:vec3f,confidence:f32,distance:f32,}',
)

/** A hit's surface: its words read (`rtSurfaceOf`), and the normal of its face that looks at the ray (`rtFacing`). */
const rtSurfaceWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `rtSurfaceWgsl(${sceneKey(scene)})`,
    [runtimeSceneWgsl(scene), NORMAL_TRANSFORM_WGSL, faceNormal],
    `
${wgslConsts({
  RT_LAYERS: RAY_LAYERS,
  RT_SURFACE_BLENDED: SURFACE_BLENDED,
  RT_SURFACE_WORDS: SURFACE_WORDS,
  RT_SURFACE_TINT: SURFACE.tint,
  RT_SURFACE_OPACITY: SURFACE.opacity,
  RT_SURFACE_EMISSION: SURFACE.emission,
  RT_SURFACE_FLAGS: SURFACE.flags,
})}
const RT_SPREAD_FLOOR:f32=${wgslF32(RAY_SPREAD_FLOOR)};
const RT_THROUGH_FLOOR:f32=${wgslF32(RAY_THROUGH_FLOOR)};
const RT_ERROR_FLOOR:f32=${wgslF32(RAY_ERROR_FLOOR)};
/** A surface's words (\`runtimeLayout.ts\`): its diffuse tint and opacity, its emission and its flags. */
struct RtSurface{tint:vec3f,opacity:f32,emission:vec3f,blended:bool,}
fn rtSurfaceOf(index:u32)->RtSurface{
 let base=rtProxy.surfacesWord+index*RT_SURFACE_WORDS;
 return RtSurface(
  rtVec(base+RT_SURFACE_TINT),rtFloat(base+RT_SURFACE_OPACITY),
  rtVec(base+RT_SURFACE_EMISSION),
  (rtProxy.words[base+RT_SURFACE_FLAGS]&RT_SURFACE_BLENDED)!=0u);
}
/** The normal of a hit's face that looks at the ray along \`direction\`. \`world\`: the linear part of
 *  the hit placement's world, which the caller read once. */
fn rtFacing(hit:RtHit,direction:vec3f,world:mat3x3f)->vec3f{
 let n=faceNormal(rtVertex(hit.triangle,0u),rtVertex(hit.triangle,1u),rtVertex(hit.triangle,2u));
 let N=linearNormal(world,n);
 return select(N,-N,dot(N,direction)>0.0);
}
`,
  )

/**
 * The run-time proxy's one walk of a ray of length `reach` from `origin`: its first surface, and
 * the ones behind it while the surfaces met let light through (a blended one's opacity), up to
 * `RT_LAYERS`. The answer is the radiance of the light they hold and `confidence` the share of the ray
 * they answer; the rest goes on to the next stage, `distance` the first surface's, `reach` where
 * none, beside the share the surfaces physically stop (`RtWalk.stopped`) and the share that went
 * on through them to the end of `reach` (`RtWalk.open`: none where the walk stopped on its layers). A deformed placement is traced at
 * its rest shape, whose reach (`marked`) its footprint may not cover: `tangent`, the width the ray's
 * lobe covers at a metre, against that reach takes CONFIDENCE from the hit (`known`), never opacity —
 * an opaque mesh stops the ray whatever its deformation. A hit's radiance: on the first surface of a
 * `lit` (probe) ray, lit by the lights and the bounce (`surfaceLit`), its emission not bounced — the
 * lamp lights the room directly —, one light loop a ray; on every other, read: its tint under the
 * irradiance the cascades already hold (`surfaceSeen`), plus a reflection's emission, no light
 * evaluated and no shadow ray cast. A walk that spends its `budget` of units (`RT_WORK` at most) has
 * not finished (`runtimeLayout.ts`): a probe's ray (`lit`) ends as an opaque hit where the walk stopped, at
 * the surface it had found, else at the distance reached (`rtReached`), its radiance what the cascades hold
 * there (`rtStoppedSeen`); a reflection's answers nothing, confidence zero, the next stage's, its budget
 * being under one node.
 */
const rtLayersWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `rtLayersWgsl(${sceneKey(scene)})`,
    [RADIANCE_ANSWER, rtSurfaceWgsl(scene), SURFACE_RAY_WGSL, worldMatrix3, markReachWgsl],
    `
/** The light an exhausted walk brings back (\`rtLayers\`): the cascades' light at \`stop\` along \`direction\` from
 *  \`start\`, read by the surface the walk had found — its tint, its face that looks at the ray —, or, where it
 *  had found none, by a surface of no tint turned to the ray (no surface it can vouch for is known). */
fn rtStoppedSeen(hit:RtHit,start:vec3f,direction:vec3f,stop:f32)->vec3f{
 let at=start+direction*stop;
 if(!hit.found){return surfaceSeen(vec3f(1.0),at,-direction);}
 let surface=rtSurfaceOf(rtWorldsInstance(hit.placement,0u)[RT_INSTANCE_SURFACE]);
 return surfaceSeen(surface.tint,at,rtFacing(hit,direction,worldMatrix3(rtWorldOf(hit.placement))));
}
/** The run-time proxy's one walk of a ray (\`rtLayers\`), the layers it crosses. */
struct RtWalk{answer:RadianceAnswer,stopped:f32,open:f32,}
fn rtLayers(origin:vec3f,direction:vec3f,reach:f32,tangent:f32,budget:u32,tests:u32,lit:bool)->RtWalk{
 rtBegin();
 rtBudget=budget;
 rtTestBudget=tests;
 var first=reach;
 var color=vec3f(0.0);
 var answered=0.0;
 var through=1.0;
 var open=0.0;
 var start=origin;
 var left=reach;
 for(var layer=0u;layer<RT_LAYERS;layer++){
  let hit=rtScene(start,direction,left);
  if(rtSpent()){
   // Its own walk spent no more than its share: the shadow rays it shares the budget with did (\`rtBlocked\`).
   if(rtWork<rtBudget&&rtTests<rtTestBudget){if(rtShadowCause==0u){rtShadowCause=rtWhy();}}
   else{rtCause=rtWhy();}
   if(!lit){return RtWalk(RadianceAnswer(vec3f(0.0),0.0,first),0.0,0.0);}
   let stop=select(rtReached,hit.distance,hit.found);
   if(layer==0u){first=stop;}
   color+=through*rtStoppedSeen(hit,start,direction,stop);
   answered+=through;
   through=0.0;
   break;
  }
  if(!hit.found){open=through;break;}
  if(layer==0u){first=hit.distance;}
  let instance=rtWorldsInstance(hit.placement,0u);
  let surface=rtSurfaceOf(instance[RT_INSTANCE_SURFACE]);
  let spread=hit.distance*tangent+RT_SPREAD_FLOOR;
  let marked=markReach(instance[RT_INSTANCE_MARK]);
  let world=worldMatrix3(rtWorldOf(hit.placement));
  let known=spread/(spread+marked*length(world[0]));
  let opacity=select(1.0,surface.opacity,surface.blended);
  let at=start+direction*hit.distance;let N=rtFacing(hit,direction,world);
  var radiance:vec3f;
  if(lit&&layer==0u){radiance=surfaceLit(surface.tint,at,N,reach);}
  else{radiance=surfaceSeen(surface.tint,at,N)+select(surface.emission,vec3f(0.0),lit);}
  let share=through*opacity;
  color+=share*known*radiance;
  answered+=share*known;
  through*=1.0-opacity;
  let travelled=hit.distance+max(rtProxy.error,RT_ERROR_FLOOR);
  start+=direction*travelled;
  left-=travelled;
  if(left<=0.0){open=through;break;}
  if(through<RT_THROUGH_FLOOR){break;}
 }
 return RtWalk(RadianceAnswer(select(vec3f(0.0),color/answered,answered>0.0),answered,first),1.0-through,open);
}
`,
  )

/**
 * THE RADIANCE OF A RAY: what a ray of the proxy (`runtimeSceneWgsl.ts`) brings back. `rtRadiance` is the
 * radiance through up to `RAY_LAYERS` surfaces — a blended one lets the rest of the light through (its opacity
 * weighs its own radiance, the transmittance goes on) —, and the confidence of the answer: what it holds, the
 * rest left to the next stage, and the distance to the first surface it met. The radiance of a surface is
 * its emission and its diffuse tint under the irradiance the cascades hold (`surfaceSeen`): read, its cost
 * the same whatever the lights. A mesh whose placement deforms is traced at its rest shape, its confidence
 * cut by the placement's reach against the footprint. `rtProbeRay` is the probes' ray on the same walk
 * (`rtLayers`), its first surface lit by the lights — shadows traced against the proxy (`rtBlocked`) — and
 * the bounce (`surfaceLit`), what the cascades are made of, the sky for the share of the ray that leaves
 * the scene (`skyProbeRadiance`: the cascades hold the sky the scene lets through), and the distance to
 * the first surface.
 */
export const runtimeRadianceWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeRadianceWgsl(${sceneKey(scene)})`,
    [rtLayersWgsl(scene), SKY_READ_WGSL],
    `
/** A reflection's ray (\`rtLayers\`, read). */
fn rtRadiance(origin:vec3f,direction:vec3f,reach:f32,tangent:f32,budget:u32)->RadianceAnswer{
 return rtLayers(origin,direction,reach,tangent,min(budget,RT_WORK),RT_TRIANGLES,false).answer;
}
/** The light a probe's ray brings back (\`rtLayers\`, lit): from \`origin\` along \`direction\`, \`reach\`
 *  far, its first surface lit and those a blended one lets it reach read behind it, weighed by what
 *  they stop, the sky for the share that leaves the scene (\`RtWalk.open\`), and the distance to the
 *  first, \`reach\` where it meets nothing. Every ray answers: one whose walk spent its budget ends as a hit
 *  where it stopped, one whose shadow ray did lit its hit as blocked (\`runtimeLayout.ts\`); what spent
 *  them is left in \`rtCause\` and \`rtShadowCause\`, for the census. */
fn rtProbeRay(origin:vec3f,direction:vec3f,reach:f32)->vec4f{
 let walk=rtLayers(origin,direction,reach,0.0,RT_PROBE_WORK,RT_PROBE_TRIANGLES,true);
 var seen=walk.answer.color*walk.stopped;
 if(walk.open>0.0){seen+=walk.open*skyProbeRadiance(direction);}
 return vec4f(seen,walk.answer.distance);
}
`,
  )
