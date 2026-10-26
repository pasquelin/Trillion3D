/**
 * THE REFLECTION: ONE SYSTEM FOR EVERY SURFACE. What a surface reflects along a lobe ray is one chain,
 * traced in two stages (`reflectionStagesWgsl`) by the image's compute pass (`trace/trace.ts`) for the opaque
 * surfaces and the transparents' front surface (`frontLayer.ts`); the blended surfaces and the water
 * read its answer, or its last stage alone (`weight.ts`) — and it reads
 * what the view holds: its depth, the previous lit image of the same view, the global distance field and the surface
 * cache, and the environment. It is one chain of
 * answers, each carrying the share of the radiance it is sure of, and giving the rest to the next:
 *
 *   L = Cs·Ls + (1 − Cs)·(Ct·Lt + (1 − Ct)·Le)
 *
 * - the screen (`reflectionSeen`): the previous lit image, at the point the ray meets in the depth;
 * - the scene (`reflectionSceneTrace`): the global distance field marched from where the screen stopped knowing the
 *   ray, then the light of the surface it meets read in the surface cache's final lighting, one
 *   ray a lobe the screen left, in the trace's scene stage alone, whose group binds both
 *   (`REFLECTION_FIELD_WGSL`, `REFLECTION_SURFACE_HIT_WGSL`); a forward fragment reads the trace's front layer, or the environment;
 * - the environment (`reflectionEnvironment`, `reflectionField`): the sky the scene shows along the ray, or else the
 *   background the screen draws around the scene, as radiance, the last word — for a ray whose fate the scene did not settle, and
 *   for the share of a lobe too rough to trace, whose bounced light the opaque resolve takes from the screen probes (`resolvedIndirect`).
 *
 * Every confidence is continuous in what it reads: a stage whose share of the radiance is left under
 * `REFLECTION_EPSILON` is not evaluated. The screen's confidence is its share of the ray, the scene
 * marched for the rest, never for the sliver a sure hit leaves, and no further than the surface the
 * screen met (`bound`). The chain reads no history of its own, so two
 * images of a still view — its turn held — give the same bits.
 *
 * - `visibility/hiz/gpu/screenMarch.ts`: the engine's hierarchical march of the depth pyramid, and where it hits;
 * - `sceneTrace.ts`: the scene's answer (`../surfaceCache/hitWgsl.ts`: the light of the surface its march meets);
 * - `field.ts`: the lobe and the environment;
 * - `weight.ts`: what a surface keeps of the radiance, and how each program binds it;
 * - `seen.ts`: `reflectionSeen`, the screen's answer along the lobe's centre, and the far trace
 *   (`reflectionDistant`); `rayLightWgsl.ts`: what a ray's radiance is held to and fogged by, and the lit image a scene
 *   hit takes;
 * - this file: the chain's last stage, and its two stages (`reflectionStagesWgsl`).
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOBE_AXIS_WGSL } from '../lobeAxisWgsl.ts'
import { REFLECTION_CLAMP_WGSL, REFLECTION_ENVIRONMENT_WGSL } from './field.ts'
import { reflectionSeenWgsl } from './seen.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_LOBE_RAY_WGSL } from './sampleWgsl.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_SCENE_TRACE_WGSL } from './sceneTrace.ts'

/** The chain's last stage (`reflectionField`), what a lobe reflects where neither the screen nor the scene answered: the radiance
 *  around the scene through the lobe (`reflectionEnvironment`), the sky light's where one shines, held to the ceiling of a ray — what a
 *  ray the scene did not settle reaches, and what the share of a lobe too rough to trace reflects of the surroundings: its light bounced
 *  is the screen probes' (`resolvedIndirect`). The trace's rays end on it, and a forward fragment that is not the front surface reads
 *  it alone (`forwardTrace`, `weight.ts`). */
export const REFLECTION_FIELD_STAGE_WGSL = wgslBlock(
  'REFLECTION_FIELD_STAGE_WGSL',
  [REFLECTION_ENVIRONMENT_WGSL, REFLECTION_CLAMP_WGSL],
  `fn reflectionField(lobe:ReflectionLobe)->vec3f{
 return reflectionClampRay(reflectionEnvironment(lobe.R,lobe.rough));
}`,
)

const SCREEN_STAGE_TEXT = `struct ReflectionChain{radiance:vec3f,rest:f32,bound:f32,hit:f32,left:f32,}
fn reflectionChainStart()->ReflectionChain{return ReflectionChain(vec3f(0.0),1.0,REFLECTION_FAR,REFLECTION_FAR,0.0);}
fn reflectionTake(ray:ptr<function,ReflectionChain>,answer:RadianceAnswer){
 (*ray).radiance+=(*ray).rest*answer.confidence*answer.color;
 if((*ray).hit>=REFLECTION_FAR&&answer.confidence>=0.5){(*ray).hit=answer.distance;}
 (*ray).rest*=1.0-answer.confidence;
}
/** The pending list's two last words of a chain (\`reflectionChainOf\` reads them): \`left\`'s bits, and the bits of what the
 *  screen met (one) and of what it answered half the ray or more (two). */
fn reflectionChainPack(ray:ReflectionChain)->vec2u{
 let met=select(0u,1u,ray.bound<REFLECTION_FAR);
 return vec2u(bitcast<u32>(ray.left),met|select(0u,2u,ray.hit<REFLECTION_FAR));
}
fn reflectionChainOf(P:vec3f,R:vec3f,rest:f32,packed:vec2u)->ReflectionChain{
 var ray=ReflectionChain(vec3f(0.0),rest,REFLECTION_FAR,REFLECTION_FAR,bitcast<f32>(packed.x));
 if((packed.y&1u)!=0u){ray.bound=ray.left+reflectionSlabAt(P,R,ray.left);}
 if((packed.y&2u)!=0u){ray.hit=ray.left;}
 return ray;
}
/** The lobe a ray is read through: its direction and its narrower width. */
fn reflectionRayLobe(lobe:ReflectionLobeRay)->ReflectionLobe{return reflectionLobeOf(lobe.R,lobe.axis.w);}
fn reflectionScreenStage(P:vec3f,N:vec3f,V:vec3f,lobe:ReflectionLobeRay)->ReflectionChain{
 var ray=reflectionChainStart();
 // The share a ray answers (\`reflectionTraceShare\`); the environment answers the rest, read through the
 // whole lobe: a lobe too rough to trace is the environment's whole, and casts no ray.
 let share=reflectionTraceShare(lobe.width);
 ray.rest=share;
 if(share>0.0&&reflectionDone(REFLECTION_SCREEN_TRACES)&&reflectionView.traced.x!=0u&&dot(N,V)>0.0){
  let seen=reflectionSeen(P,N,reflectionRayLobe(lobe),reflectionRayBias(P,N));
  ray.left=seen.left;
  // The scene is marched no further than the surface the screen met.
  if(seen.answer.confidence>0.0){ray.bound=seen.answer.distance+reflectionSlabAt(P,lobe.R,seen.answer.distance);}
  reflectionTake(&ray,seen.answer);
 }
 // The environment through the whole lobe for the share no ray answers.
 if(share<1.0){
  let wide=reflectionLobeOf(reflect(-V,N),lobe.alpha);
  ray.radiance=(1.0-share)*reflectionField(wide)+ray.radiance;
 }
 return ray;
}
fn reflectionFieldRest(P:vec3f,N:vec3f,lobe:ReflectionLobeRay,before:ReflectionChain)->ReflectionChain{
 var ray=before;
 if(ray.rest>REFLECTION_EPSILON){ray.radiance+=ray.rest*reflectionField(reflectionRayLobe(lobe));}
 ray.rest=0.0;
 return ray;
}`

const SCENE_STAGE_TEXT = `fn reflectionSceneStage(P:vec3f,N:vec3f,lobe:ReflectionLobeRay,screen:ReflectionChain,coord:vec2u,cone:f32)->ReflectionChain{
 var ray=screen;
 if(ray.rest>REFLECTION_EPSILON){
  let before=ray.rest;
  // From where the screen stopped knowing the ray: a surface it met, its slab before it, else a little past the march's end.
  let met=ray.bound<REFLECTION_FAR;
  let begin=select(ray.left+0.02,max(ray.left-reflectionSlabAt(P,lobe.R,ray.left),0.0),met);
  let traced=reflectionSceneTrace(P,reflectionRayLobe(lobe),begin,ray.bound,coord,cone);
  reflectionTake(&ray,traced.answer);
  // The share that left the scene looks at the screen once more, past the field, then sees the environment alone;
  // the environment stands for the rest.
  var open=min(before*traced.open,ray.rest);
  if(open>REFLECTION_EPSILON){
   let far=reflectionDistant(P,N,reflectionRayLobe(lobe),coord);
   let taken=open*far.confidence;
   ray.radiance+=taken*far.color;
   ray.rest-=taken;
   open-=taken;
   if(taken>0.0){
    reflectionFate=select(reflectionFate,REFLECTION_FATE_DISTANT,reflectionFate==REFLECTION_FATE_OPEN);
    if(ray.hit>=REFLECTION_FAR&&far.confidence>=0.5){ray.hit=far.distance;}
   }
  }
  let sky=reflectionFogged(reflectionEnvironment(lobe.R,0.0)+reflectionSkylightLeak(vec3f(0.0)),P,lobe.R*max(reflectionView.light.w,reflectionView.march.w));
  ray.radiance+=open*reflectionClampRay(sky);
  ray.rest-=open;
 }
 return reflectionFieldRest(P,N,lobe,ray);
}`

/**
 * THE CHAIN IN TWO STAGES, each its own kernel (`trace/trace.ts`): the screen first, the cheap answer for
 * every ray, and the scene after for the rays the screen left, so the costly march runs on few threads. A ray's chain (`ReflectionChain`) carries what its
 * stages answered so far — the radiance, the share still unanswered (`rest`), the farthest the scene
 * may be marched (`bound`: the surface the screen met), the distance of what answered the larger share
 * (`hit`, `REFLECTION_FAR` where none did yet: what the resolve reaches by,
 * `reflectionReuseReach`, `resolveWgsl.ts`) and where the screen stopped knowing the ray (`left`, a distance along it).
 * `reflectionTake` adds one answer to it. The scene stage is handed the chain as the pending list holds it
 * (`reflectionChainPack`, `reflectionChainOf`): the share, `left` — a surface the screen met, its distance; else where
 * the march stopped — and two bits, whether the screen met a surface and whether it answered half the ray or more.
 *
 * - `reflectionScreenStage`: the screen's answer along the lobe ray `lobe` (`sampleWgsl.ts`) of a
 *   surface at `P`, of normal `N`, seen from `V` (`reflectionSeen`, `seen.ts`);
 * - `reflectionSceneStage`: what the screen left of a ray, the scene's answer (`reflectionSceneTrace`) from where the
 *   screen stopped knowing it — a surface it met, its slab before it —, then, so the ray is whole, for the share the
 *   march saw leave the scene (`open`) what the screen shows past the field (`reflectionDistant`, where the
 *   setting is on) and the environment's for the rest, fogged over the sky's length and held to the ceiling of a ray, the
 *   environment's for what remains (`reflectionFieldRest`).
 *
 * A lobe answers by its ray the share its roughness gives it (`reflectionTraceShare`), the environment the
 * rest, read through the whole lobe, in the screen stage: never a coin toss between the two, which
 * leaves the denoiser a field of dots to average; a lobe too rough to trace casts no ray at all.
 */
export const reflectionStagesWgsl = (group: number) =>
  wgslBlock(
    `reflectionStagesWgsl(${group})`,
    [
      reflectionSeenWgsl(group),
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_FIELD_STAGE_WGSL,
      REFLECTION_REACH_WGSL,
      REFLECTION_LOBE_RAY_WGSL,
      LOBE_AXIS_WGSL,
      REFLECTION_SCENE_TRACE_WGSL,
    ],
    `${SCREEN_STAGE_TEXT}\n${SCENE_STAGE_TEXT}`,
  )
