import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { wgslBlock, wgslStruct } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { surfaceRayWgsl } from '../surfaceRayWgsl.ts'
import {
  lightFunctionBindingsLabel,
  type LightFunctionBindings,
} from '../../lightFunction/readWgsl.ts'
import { NORMAL_TRANSFORM_WGSL } from '../../standardLighting.ts'
import { faceNormal } from '../../../../../math/src/wgsl/geometry.ts'
import { worldMatrix3 } from '../../../../../math/src/wgsl/matrix.ts'
import { markReachWgsl } from '../../../deformation/halfFloat.ts'
import { runtimeSceneWgsl } from './runtimeSceneWgsl.ts'
import { runtimeShadowWgsl } from './runtimeShadowWgsl.ts'
import { runtimeRingsWgsl } from './runtimeRingsWgsl.ts'
import { sceneKey, type SceneBindings } from '../sceneBindings.ts'
import type { CloudShadowBindings } from '../../atmosphere/cloudShadowRead.ts'
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

/** The light an exhausted walk brings back (`rtLayers`): the cascades' light at `stop` along `direction` from
 *  `start`, read by the surface the walk was at. */
const rtStoppedWgsl = (
  scene: SceneBindings,
  seen: string,
  lightFunction?: LightFunctionBindings,
  cloudShadow?: CloudShadowBindings,
) =>
  wgslBlock(
    `rtStoppedWgsl(${sceneKey(scene)},${seen}, ${lightFunctionBindingsLabel(lightFunction)}, ${cloudShadow?.block ?? null})`,
    [rtSurfaceWgsl(scene), surfaceRayWgsl(lightFunction, cloudShadow), worldMatrix3, NO_INDEX],
    `
/** The surface is the hit's, its tint and its face that looks at the ray; where the walk found none, that of the
 *  placement of its furthest entry (\`rtReachedPlacement\`), turned to the ray; where it had entered none, a surface
 *  of no tint (no surface it can vouch for is known). */
fn rtStoppedSeen(hit:RtHit,start:vec3f,direction:vec3f,stop:f32)->vec3f{
 let at=start+direction*stop;
 let placement=select(rtReachedPlacement,hit.placement,hit.found);
 if(placement==NO_INDEX){return ${seen}(vec3f(1.0),vec3f(0.0),at,-direction);}
 let tint=rtSurfaceOf(rtWorldsInstance(placement,0u)[RT_INSTANCE_SURFACE]).tint;
 if(!hit.found){return ${seen}(tint,vec3f(0.0),at,-direction);}
 return ${seen}(tint,vec3f(0.0),at,rtFacing(hit,direction,worldMatrix3(rtWorldOf(placement))));
}
`,
  )

/** The function that reads what a surface the walk met, not lit by the lights, brings back: from its tint and its
 *  emission, at the point `at` of its face turned to the ray `N`. The default reads what the cascades hold there
 *  (`surfaceSeen`) and adds the emission; a program that reads more (a reflection that takes the image the view
 *  already holds) names its own, with this signature. */
const RT_SEEN = 'rtSeenRead'
const RT_SEEN_WGSL = wgslBlock(
  'RT_SEEN_WGSL',
  [],
  `fn ${RT_SEEN}(tint:vec3f,emission:vec3f,at:vec3f,N:vec3f)->vec3f{return surfaceSeen(tint,at,N)+emission;}`,
)

/** What a walk answers (`RtWalk`) and what a surface it met adds to it (`rtLayerOf`). */
const rtLayerWgsl = (scene: SceneBindings, seen: string) =>
  wgslBlock(
    `rtLayerWgsl(${sceneKey(scene)},${seen})`,
    [
      RADIANCE_ANSWER,
      rtSurfaceWgsl(scene),
      worldMatrix3,
      markReachWgsl,
      ...(seen === RT_SEEN ? [RT_SEEN_WGSL] : []),
    ],
    `
/** The run-time proxy's one walk of a ray (\`rtLayers\`), the layers it crosses: its answer, the share the
 *  surfaces stop, the share that went through, and, of a ringed walk, what spent the first ring that was
 *  (\`RT_CAUSE_*\`, zero where none was) and the units its rings spent together; of any other, \`rtCause\` and \`rtWork\`. */
struct RtWalk{answer:RadianceAnswer,stopped:f32,open:f32,spent:u32,work:u32,}
fn rtWalkOf(answer:RadianceAnswer,stopped:f32,open:f32,ringed:bool,cause:u32,walked:u32)->RtWalk{
 return RtWalk(answer,stopped,open,select(rtCause,cause,ringed),select(rtWork,walked,ringed));
}
/** What a surface the walk met adds to it: its radiance, the opacity it weighs it by, the share of the hit the walk knows
 *  (\`known\`: a deformed placement's reach against the footprint, never opacity) and how far the walk goes on past it. */
struct RtLayer{radiance:vec3f,opacity:f32,known:f32,travelled:f32,}
fn rtLayerOf(hit:RtHit,start:vec3f,direction:vec3f,tangent:f32,reach:f32,lit:bool,layer:u32)->RtLayer{
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
 else{radiance=${seen}(surface.tint,select(surface.emission,vec3f(0.0),lit),at,N);}
 return RtLayer(radiance,opacity,known,hit.distance+max(rtProxy.error,RT_ERROR_FLOOR));
}
`,
  )

const RT_LAYERS_TEXT = `
fn rtLayers(origin:vec3f,direction:vec3f,reach:f32,tangent:f32,budget:u32,tests:u32,lit:bool)->RtWalk{
 return rtLayersOver(origin,direction,reach,tangent,budget,tests,lit,rtNoRings());
}
/** \`rtLayers\` over the windows \`rings\`: the same walk, each layer's nearest surface that of the first window that
 *  holds one (\`rtNearest\`, the ring's own budget in place of \`budget\` and \`tests\`), which a spent window never
 *  loses; none of them, the layer is the ray's end. Without windows, \`rtLayers\` itself. */
fn rtLayersOver(origin:vec3f,direction:vec3f,reach:f32,tangent:f32,budget:u32,tests:u32,lit:bool,rings:RtRings)->RtWalk{
 rtBegin();rtBudget=budget;rtTestBudget=tests;
 let ringed=rings.on;
 var first=reach;
 var color=vec3f(0.0);
 var answered=0.0;
 var through=1.0;var open=0.0;
 var start=origin;var left=reach;
 var cause=0u;var walked=0u;
 for(var layer=0u;layer<RT_LAYERS;layer++){
  var hit:RtHit;
  var spent=false;var stops=false;
  if(ringed){
   let near=rtNearest(start,direction,left,reach-left,rings);
   hit=near.hit;stops=near.stopped;spent=near.stopped;
   walked+=near.work;
   if(cause==0u){cause=near.cause;}
  }else{
   hit=rtScene(start,direction,left);
   spent=rtSpent();
  }
  if(spent){
   rtCause=rtWhy();
   if(!lit&&!stops){return rtWalkOf(RadianceAnswer(vec3f(0.0),0.0,first),0.0,0.0,ringed,cause,walked);}
   let stop=select(rtReached,hit.distance,hit.found);
   if(layer==0u){first=stop;}
   color+=through*rtStoppedSeen(hit,start,direction,stop);
   answered+=through;
   through=0.0;
   break;
  }
  if(!hit.found){open=through;break;}
  if(layer==0u){first=hit.distance;}
  let seen=rtLayerOf(hit,start,direction,tangent,reach,lit,layer);
  let share=through*seen.opacity;
  color+=share*seen.known*seen.radiance;
  answered+=share*seen.known;
  through*=1.0-seen.opacity;
  start+=direction*seen.travelled;
  left-=seen.travelled;
  if(left<=0.0){open=through;break;}
  if(through<RT_THROUGH_FLOOR){break;}
 }
 if(ringed){rtCause=cause;}
 return rtWalkOf(RadianceAnswer(select(vec3f(0.0),color/answered,answered>0.0),answered,first),1.0-through,open,ringed,cause,walked);
}
`

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
 * the surface it had found, else at the distance reached (`rtReached`) in the placement of its furthest entry,
 * its radiance what the cascades hold there (`rtStoppedSeen`); a reflection's answers nothing, confidence
 * zero, the next stage's.
 *
 * RINGS (`rtLayersOver`, `RtRings`): a walk may be cut into windows along the ray, each walked on a budget
 * of its own, the nearest surface of a layer being that of the first window that holds one. A window that
 * spends its budget has met nothing it can vouch for and is skipped, the walk going on at its end — unless
 * it had already found a surface: that one is kept and answers, never lost to the spend (the nearest of what
 * the window entered, a nearer one possibly in what it left unwalked) —; a ray that meets nothing in any
 * window leaves through `open`. A ring is walked only within the box of the placement tree's root, which holds every
 * surface the tree can answer. A leading detail window is the other rule: its result, a surface it found or the
 * stop of a walk that spent its budget (as a probe's, a hit where the walk stopped), is taken by noise against a
 * fade; refused, the rings go on from where it stopped. The windows are the caller's (`rtLayers` has none: every
 * walk it makes is one). The radiance of a surface that is not a probe's first is read by the function the caller
 * names (`runtimeRadianceWgsl`).
 */
const rtLayersWgsl = (
  scene: SceneBindings,
  seen: string,
  lightFunction?: LightFunctionBindings,
  cloudShadow?: CloudShadowBindings,
) =>
  wgslBlock(
    `rtLayersWgsl(${sceneKey(scene)},${seen}, ${lightFunctionBindingsLabel(lightFunction)}, ${cloudShadow?.block ?? null})`,
    [
      rtStoppedWgsl(scene, seen, lightFunction, cloudShadow),
      runtimeRingsWgsl(scene),
      rtLayerWgsl(scene, seen),
      surfaceRayWgsl(lightFunction, cloudShadow),
    ],
    RT_LAYERS_TEXT,
  )

/**
 * THE RADIANCE OF A RAY: what a ray of the proxy (`runtimeSceneWgsl.ts`) brings back. `rtRadiance` is the
 * radiance through up to `RAY_LAYERS` surfaces — a blended one lets the rest of the light through (its opacity
 * weighs its own radiance, the transmittance goes on) —, and the confidence of the answer: what it holds, the
 * rest left to the next stage, and the distance to the first surface it met. The radiance of a surface is
 * its emission and its diffuse tint under the irradiance the cascades hold (`surfaceSeen`): read, its cost
 * the same whatever the lights. A mesh whose placement deforms is traced at its rest shape, its confidence
 * cut by the placement's reach against the footprint. `rtProbeRay` (`runtimeProbeRayWgsl`) is the probes' ray on the same walk
 * (`rtLayers`), its first surface lit by the lights — shadows traced against the proxy (`rtBlocked`) — and
 * the bounce (`surfaceLit`), what the cascades are made of, the sky for the share of the ray that leaves
 * the scene (`skyProbeRadiance`: the cascades hold the sky the scene lets through), and the distance to
 * the first surface. Where the program binds the light functions' atlas (`lightFunction`), the lights that
 * light a hit wear their light functions (`lightsIrradiance`); a program without it, a reflection's, lights plain.
 */
export const runtimeRadianceWgsl = (
  scene: SceneBindings,
  lightFunction?: LightFunctionBindings,
  cloudShadow?: CloudShadowBindings,
  seen = RT_SEEN,
) =>
  wgslBlock(
    `runtimeRadianceWgsl(${sceneKey(scene)}, ${lightFunctionBindingsLabel(lightFunction)}, ${cloudShadow?.block ?? null},${seen})`,
    [rtLayersWgsl(scene, seen, lightFunction, cloudShadow), runtimeShadowWgsl(scene)],
    `
/** A reflection's ray (\`rtLayers\`, read). */
fn rtRadiance(origin:vec3f,direction:vec3f,reach:f32,tangent:f32,budget:u32)->RadianceAnswer{
 return rtLayers(origin,direction,reach,tangent,min(budget,RT_WORK),RT_TRIANGLES,false).answer;
}
`,
  )

/** The probes' ray (\`rtProbeRay\`), over \`runtimeRadianceWgsl\` and the sky light's read, which its program
 *  declares (\`skyLightReadWgsl\`). */
export const runtimeProbeRayWgsl = (
  scene: SceneBindings,
  lightFunction?: LightFunctionBindings,
  cloudShadow?: CloudShadowBindings,
) =>
  wgslBlock(
    `runtimeProbeRayWgsl(${sceneKey(scene)}, ${lightFunctionBindingsLabel(lightFunction)}, ${cloudShadow?.block ?? null})`,
    [runtimeRadianceWgsl(scene, lightFunction, cloudShadow), SKY_READ_WGSL],
    `
/** What a probe's ray found (\`rtProbeRayOpen\`): the light of the surfaces it met, the share of it that left the scene, and the
 *  distance to the first surface. */
struct RtProbeSeen{seen:vec3f,open:f32,distance:f32,}
/** The light a probe's ray brings back (\`rtLayers\`, lit), the sky kept apart: from \`origin\` along \`direction\`, \`reach\`
 *  far, its first surface lit and those a blended one lets it reach read behind it, weighed by what they stop, the share that
 *  leaves the scene (\`RtWalk.open\`), and the distance to the first, \`reach\` where it meets nothing. Every ray answers:
 *  one whose walk spent its budget ends as a hit where it stopped (\`runtimeLayout.ts\`); what spent it is left in
 *  \`rtCause\`, what spent a shadow ray of its hits in \`rtShadowCause\`, for the census. */
fn rtProbeRayOpen(origin:vec3f,direction:vec3f,reach:f32)->RtProbeSeen{
 let walk=rtLayers(origin,direction,reach,0.0,RT_PROBE_WORK,RT_PROBE_TRIANGLES,true);
 return RtProbeSeen(walk.answer.color*walk.stopped,walk.open,walk.answer.distance);
}
/** The light a probe's ray brings back, the sky for the share that leaves the scene (\`skyProbeRadiance\`: the cascades hold the sky
 *  the scene lets through), and the distance to the first surface (\`rtProbeRayOpen\`). */
fn rtProbeRay(origin:vec3f,direction:vec3f,reach:f32)->vec4f{
 let found=rtProbeRayOpen(origin,direction,reach);
 var seen=found.seen;
 if(found.open>0.0){seen+=found.open*skyProbeRadiance(direction);}
 return vec4f(seen,found.distance);
}
`,
  )
