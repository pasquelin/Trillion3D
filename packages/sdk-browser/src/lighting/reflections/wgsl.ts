/**
 * THE REFLECTION: ONE SYSTEM FOR EVERY SURFACE. What a surface reflects along a lobe ray is one chain,
 * traced in two stages (`reflectionStagesWgsl`) by the image's compute pass (`trace/trace.ts`) for the opaque
 * surfaces and the transparents' front surface (`frontLayer.ts`); the blended surfaces and the water
 * read its answer, or its last stage alone (`weight.ts`) — and it reads
 * what the view holds: its depth, the previous lit image of the same view, the global distance field and the surface
 * cache, and the environment. Each stage ends a ray in a hit or a miss, never in part: a hit is final, a miss goes
 * to the next stage, from the distance it reached:
 *
 * - the screen (`reflectionSeen`): the previous lit image, at the point the ray meets in the depth;
 * - the scene (`reflectionSceneTrace`): the global distance field marched from where the screen stopped knowing the
 *   ray, then the light of the surface it meets read in the surface cache's final lighting, one
 *   ray a lobe the screen missed, in the trace's scene stage alone, whose group binds both
 *   (`REFLECTION_FIELD_WGSL`, `REFLECTION_SURFACE_HIT_WGSL`); or, where the scene has acceleration structures, the scene's triangles traced
 *   instead (`sceneTraceHardware.ts`, the scene stage's other program: its group binds the cut's tables and the surface cache, its third the
 *   scene trace); a forward fragment reads the trace's front layer, or the environment;
 * - the environment (`reflectionEnvironment`, `reflectionField`): the sky the scene shows along the ray, or else the
 *   background the screen draws around the scene, as radiance, the last word — for a ray whose fate the scene did not settle, and
 *   for the share of a lobe too rough to trace, which the last pass (`bilateralWgsl.ts`) blends with the ray's answer by the lobe's share
 *   (`reflectionTraceShare`) and the opaque resolve takes from the screen probes instead (`resolvedIndirect`).
 *
 * The chain reads no history of its own, so two images of a still view — its turn held — give the same bits.
 *
 * - `visibility/hiz/gpu/screenMarch.ts`: the engine's hierarchical march of the depth pyramid, and where it hits;
 * - `sceneTrace.ts`: the scene's answer (`../surfaceCache/hitWgsl.ts`: the light of the surface its march meets);
 *   `sceneTraceHardware.ts`: the same answer from the scene's triangles;
 * - `field.ts`: the lobe and the environment;
 * - `weight.ts`: what a surface keeps of the radiance, and how each program binds it;
 * - `seen.ts`: `reflectionSeen`, the screen's answer along the lobe's centre, and the far trace
 *   (`reflectionDistant`); `rayLightWgsl.ts`: what a ray's radiance is held to and fogged by, and the lit image a scene
 *   hit takes;
 * - this file: the chain's last stage, and its two stages (`reflectionStagesWgsl`).
 */
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { LOBE_AXIS_WGSL } from '../lobeAxisWgsl.ts'
import { REFLECTION_CLAMP_WGSL, REFLECTION_ENVIRONMENT_WGSL } from './field.ts'
import { reflectionSeenWgsl } from './seen.ts'
import type { MarchLanes } from '../../visibility/hiz/gpu/screenMarchLanes.ts'

import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_LOBE_RAY_WGSL } from './sampleWgsl.ts'
import { REFLECTION_FIRST_PERSON_WGSL } from './firstPerson.ts'

/** The chain's last stage (`reflectionField`), what a lobe reflects where neither the screen nor the scene answered: the radiance
 *  around the scene through the lobe (`reflectionEnvironment`), the sky light's where one shines, held to the ceiling of a ray — what a
 *  ray the scene did not settle reaches, and what the share of a lobe too rough to trace reflects of the environment: its light bounced
 *  is the screen probes' (`resolvedIndirect`). The trace's rays end on it, and a forward fragment that is not the front surface reads
 *  it alone (`forwardTrace`, `weight.ts`). */
export const REFLECTION_FIELD_STAGE_WGSL = wgslBlock(
  'REFLECTION_FIELD_STAGE_WGSL',
  [REFLECTION_ENVIRONMENT_WGSL, REFLECTION_CLAMP_WGSL],
  `fn reflectionField(lobe:ReflectionLobe)->vec3f{
 return reflectionClampRay(reflectionEnvironment(lobe.R,lobe.rough));
}`,
)

const SCREEN_STAGE_TEXT = `/** What a stage of a ray ends with: the radiance it brought back, whether it met a surface (a hit) or the ray goes on (a miss), and the
 *  distance: of the hit from the surface the ray left; of a miss, where the next stage begins. */
struct ReflectionEnd{radiance:vec3f,hit:bool,distance:f32,}
/** The lobe a ray is read through: its direction and its narrower width. */
fn reflectionRayLobe(lobe:ReflectionLobeRay)->ReflectionLobe{return reflectionLobeOf(lobe.R,lobe.axis.w);}
/** The screen stage of a ray in three steps, so that the march of the screen (\`reflectionSeenMarch\`), which the threads of a workgroup may have to take
 *  part in together (\`screenMarchLanes.ts\`), stands in the kernel's uniform control flow: \`reflectionScreenBegin\` the ray's span and whether the screen is traced
 *  for it (\`live\`: the screen traced this image and the ray's origin, off along the normal, inside the image — \`reflectionOriginOnScreen\`), the march of the
 *  kernel, \`reflectionScreenEnd\` the stage's end. \`reflectionScreenNone\` is the cast of a thread with no ray. */
struct ReflectionScreenCast{ray:ReflectionRay,bias:f32,live:bool,}
fn reflectionScreenNone()->ReflectionScreenCast{
 return ReflectionScreenCast(ReflectionRay(vec3f(0.0),vec3f(0.0),0.0,1.0,1.0,0.0,0.0),0.0,false);
}
fn reflectionScreenBegin(P:vec3f,N:vec3f,lobe:ReflectionLobeRay)->ReflectionScreenCast{
 let bias=reflectionRayBias(P,N);
 let live=reflectionDone(REFLECTION_SCREEN_TRACES)&&reflectionView.traced.x!=0u&&reflectionOriginOnScreen(P,N,bias);
 return ReflectionScreenCast(reflectionRaySpan(P,N,reflectionRayLobe(lobe),bias,0.0,reflectionFar()),bias,live);
}
/** The end of the screen stage of a ray, \`marched\` the march of its cast: a hit, which is final, or a miss, whose distance is where the screen stopped
 *  knowing the ray, lengthened by \`REFLECTION_MISS_OFFSET\`, held to the longest ray and handed off no further than the first-person stand-ins' sphere
 *  (\`reflectionClipFirstPerson\`); 0 where the screen was not traced for it. */
fn reflectionScreenEnd(P:vec3f,N:vec3f,lobe:ReflectionLobeRay,aimed:ReflectionScreenCast,marched:ScreenHit,coord:vec2u)->ReflectionEnd{
 var ended=ReflectionEnd(vec3f(0.0),false,0.0);
 if(!aimed.live){return ended;}
 let seen=reflectionSeen(P,N,reflectionRayLobe(lobe),aimed.ray,aimed.bias,marched,coord);
 if(seen.answer.hit){return ReflectionEnd(seen.answer.color,true,min(seen.answer.distance,reflectionFar()));}
 ended.distance=reflectionClipFirstPerson(P,lobe.R,min(seen.left+REFLECTION_MISS_OFFSET,reflectionFar()));
 return ended;
}`

const SCENE_STAGE_TEXT = `/** The scene stage of a ray the screen missed, which begins at \`begin\` metres: a hit of the scene, or else a miss that looks at the screen
 *  once more past the field where the ray left the scene, then at the environment. \`firstPerson\`: the ray is cast from a pixel of a
 *  first-person object (\`reflectionSceneTrace\` then leaves out the stand-ins of first-person objects). */
fn reflectionSceneStage(P:vec3f,N:vec3f,lobe:ReflectionLobeRay,begin:f32,coord:vec2u,cone:f32,firstPerson:bool)->ReflectionEnd{
 let traced=reflectionSceneTrace(P,N,reflectionRayLobe(lobe),begin,coord,cone,firstPerson);
 // @cut traced -> ReflectionEnd(vec3f(0.0),false,0.0) keep: if(f32(traced.answer.color.x)+f32(traced.answer.distance)+select(0.0,1.0,traced.answer.hit)+select(0.0,1.0,traced.open)+f32(P.x)+f32(N.x)<-1e30){textureStore(traceOut,vec2i(coord),vec4u(1u));}
 if(traced.answer.hit){return ReflectionEnd(traced.answer.color,true,traced.answer.distance);}
 if(traced.open){
  let far=reflectionDistant(P,N,reflectionRayLobe(lobe),coord);
  // @cut distant -> ReflectionEnd(vec3f(0.0),false,0.0) keep: if(f32(far.color.x)+select(0.0,1.0,far.hit)+f32(traced.answer.color.x)+f32(traced.answer.distance)+f32(P.x)<-1e30){textureStore(traceOut,vec2i(coord),vec4u(1u));}
  if(far.hit){
   reflectionFate=select(reflectionFate,REFLECTION_FATE_DISTANT,reflectionFate==REFLECTION_FATE_OPEN);
   return ReflectionEnd(reflectionClampRay(far.color+reflectionSkylightLeak(vec3f(0.0))),true,reflectionView.march.w);
  }
  let sky=reflectionFogged(reflectionEnvironment(lobe.R,0.0)+reflectionSkylightLeak(vec3f(0.0)),P,lobe.R*max(reflectionView.light.w,reflectionView.march.w));
  // @cut sky -> ReflectionEnd(vec3f(0.0),false,0.0) keep: if(f32(sky.x)+f32(sky.y)+f32(far.color.x)+select(0.0,1.0,far.hit)+f32(traced.answer.color.x)+f32(traced.answer.distance)<-1e30){textureStore(traceOut,vec2i(coord),vec4u(1u));}
  return ReflectionEnd(reflectionClampRay(sky),false,reflectionFar());
 }
 return ReflectionEnd(reflectionField(reflectionRayLobe(lobe)),false,reflectionFar());
}`

/**
 * THE CHAIN IN TWO STAGES, each its own kernel (`trace/trace.ts`): the screen first, the cheap answer for
 * every ray, and the scene after for the rays the screen missed, so the costly march runs on few threads. A stage ends a ray
 * (`ReflectionEnd`) with its radiance, whether it was a hit and a distance: the hit's, or where a miss stopped being known, which the
 * next stage begins at — the pending list holds it beside the ray's texel.
 *
 * - `reflectionScreenBegin`, the march (`reflectionSeenMarch`, `seen.ts`) and `reflectionScreenEnd`: the screen's answer along the lobe ray `lobe` (`sampleWgsl.ts`, the ray the generation stored) of a
 *   surface at `P`, of normal `N`, cast from the grid texel `coord` (`reflectionSeen`, `seen.ts`): a hit, or a
 *   miss at the distance the screen stopped knowing the ray, lengthened by `REFLECTION_MISS_OFFSET` (the distance of a
 *   march is not reliable), held to the longest ray and clipped to where it enters the sphere of the first-person stand-ins
 *   (`reflectionClipFirstPerson`, `firstPerson.ts`), none where the ray's biased origin lies off the image;
 * - `reflectionSceneStage`: what the screen missed of a ray cast from the grid texel `coord`, the scene's answer (`reflectionSceneTrace`) from where the
 *   screen stopped knowing it, then, where the march saw the ray leave the scene (`open`), what the screen shows past the field
 *   (`reflectionDistant`, where the setting is on) and the environment's, fogged over the sky's length and held to the ceiling of a ray;
 *   the environment through the lobe for the ray no stage settled. A ray that meets a surface no card lights is a black hit; a ray, a hit or a miss, that ends in the far trace or the sky is told at the longest ray (`ReflectionView.march.w`).
 *
 * `stored`: the depth the last image kept is bound as a read-only storage texture (`reflectionPastWgsl`), as the scene stage through the scene's triangles reads it.
 *
 * Every ray that traces is a whole ray: the share of a lobe it answers is the last pass's (`bilateralWgsl.ts`), which blends the denoised
 * ray with the environment, never a coin toss between the two, which leaves the denoiser a field of dots to average; a lobe too rough to trace casts no ray at all.
 */
export const reflectionStagesWgsl = (
  group: number,
  sceneTrace: WgslDecl,
  stored = false,
  lanes: MarchLanes = 'none',
  probe = false,
) =>
  wgslBlock(
    `reflectionStagesWgsl(${group},${sceneTrace.name},${stored},${lanes}${probe ? ',probe' : ''})`,
    [
      reflectionSeenWgsl(group, stored, lanes, probe),
      REFLECTION_FIRST_PERSON_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_FIELD_STAGE_WGSL,
      REFLECTION_LOBE_RAY_WGSL,
      LOBE_AXIS_WGSL,
      sceneTrace,
    ],
    `${SCREEN_STAGE_TEXT}\n${SCENE_STAGE_TEXT}`,
  )
