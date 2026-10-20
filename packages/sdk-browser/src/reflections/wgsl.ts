/**
 * THE REFLECTION: ONE SYSTEM FOR EVERY SURFACE. What a surface reflects along a lobe ray is one chain,
 * traced in two stages (`reflectionStagesWgsl`) by the image's compute pass (`trace.ts`) for the opaque
 * surfaces and the transparents' front surface (`frontLayer.ts`); the blended surfaces and the water
 * read its answer, or its last stage alone (`weight.ts`) — and it reads
 * what the view holds: its depth, the previous lit image of the same view, the resident proxy and the
 * bounce probes, and the environment. It is one chain of
 * answers, each carrying the share of the radiance it is sure of, and giving the rest to the next:
 *
 *   L = Cs·Ls + (1 − Cs)·(Cp·Lp + (1 − Cp)·(Cf·Lf + (1 − Cf)·Le))
 *
 * - the screen (`reflectionSeen`): the previous lit image, at the point the ray meets in the depth;
 * - the proxy (`reflectionProxied`): the scene's coarse geometry, past what the screen sees, one ray a
 *   lobe the screen left, in the trace's scene stage alone, whose group binds it
 *   (`REFLECTION_PROXY_BINDINGS`); a forward fragment reads the trace's front layer, or the field;
 * - the field (`reflectionProbesGathered` over `reflectionEnvironment`): the bounce probes' radiance
 *   through the lobe added to the radiance around the scene, `Lf = Le + Lg`, where the probes reach —
 *   so that the chain's last two stages are `Le + Cf·Lg`, the environment always under the probes —,
 *   for a ray whose fate the proxy did not settle; one its walk proved to leave the scene skips it;
 * - the environment (`reflectionEnvironment`): the background the screen draws around the scene,
 *   as radiance, the last word.
 *
 * Every confidence is continuous in what it reads: a stage whose share of the radiance is left under
 * `REFLECTION_EPSILON` is not evaluated. The screen's confidence is its share of the ray, the proxy
 * walking for the rest, never for the sliver a sure hit leaves, and no further than the surface the
 * screen met (`bound`). The chain reads no history of its own, so two
 * images of a still view — its turn held — give the same bits.
 *
 * - `gpu/hiz/screenMarch.ts`: the engine's hierarchical march of the depth pyramid, and where it hits;
 * - `footprint.ts`: the cone of the lobe, the footprint it reads of the radiance pyramid
 *   (`radiance.ts`), and the fades that make the screen's answer a confidence;
 * - `proxy.ts`: the proxy's answer;
 * - `field.ts`: the lobe, the environment and the probes through it;
 * - `weight.ts`: what a surface keeps of the radiance, and how each program binds it;
 * - this file: `reflectionSeen`, the screen's answer along the lobe's centre, and the chain's two
 *   stages (`reflectionStagesWgsl`).
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import {
  REFLECTION_ENVIRONMENT_WGSL,
  REFLECTION_PROBES_PAIR_WGSL,
  REFLECTION_PROBES_SHARE_WGSL,
  REFLECTION_PROBES_WGSL,
} from './field.ts'
import { reflectionFootprintWgsl } from './footprint.ts'
import { reflectionRayWgsl } from './ray.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_DEPTH_BINDING } from './viewLayout.ts'
import { SCREEN_MARCH_WGSL } from '../gpu/hiz/screenMarch.ts'
import { RADIANCE_ANSWER } from '../bounce/runtimeRadianceWgsl.ts'
import { REFLECTION_LOBE_RAY_WGSL } from './sampleWgsl.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_PROXY_WGSL } from './proxy.ts'

/** `reflectionSeen`: the screen's answer to a surface at `P`, of normal `N`, reflecting through
 *  `lobe` — the march along its centre, exact (`screenMarch`), the hit on its plane, its footprint (`reflectionFootprint`)
 *  and its confidence: how surely the screen answers — the fades of the image's border (in this image
 *  and in the one the radiance is read from) and of the footprint's pyramid level
 *  (`reflectionLevelTrust`) — times the share of the depth-weighted reads the image covers, continuous
 *  both: a hit near the border answers part of its ray, the scene stage the rest, never a coin toss
 *  between the two that leaves the denoiser a field of dots to average. The march's budget cuts no ray (`screenMarch`'s floor level). A hit has no fade of its own, neither by its
 *  depth in the slab nor by the side its plane faces: either gate turns on and off between
 *  neighbouring pixels at a thin surface, whose plane and slab depth jump from one to the next,
 *  and breaks the reflection of a body the ray passes through into shards of its edges. */
const reflectionSeenWgsl = (group: number) =>
  wgslBlock(
    `reflectionSeenWgsl(${group})`,
    [
      RADIANCE_ANSWER,
      reflectionFootprintWgsl(group),
      reflectionRayWgsl(group),
      SCREEN_MARCH_WGSL(group, REFLECTION_DEPTH_BINDING),
      clipToFramebuffer,
    ],
    `fn reflectionSeen(P:vec3f,N:vec3f,lobe:ReflectionLobe,surfacePixel:f32)->RadianceAnswer{
 var seen=RadianceAnswer(vec3f(0.0),0.0,0.0);
 let size=view.viewport.xy;
 let ray=reflectionRay(P,N,lobe,surfacePixel);
 let marched=screenMarch(ray.o,ray.d,ray.end,REFLECTION_THICKNESS,reflectionView.slab,REFLECTION_MARCH_STEPS);
 if(marched.t<0.0||marched.plane.x<=0.0){return seen;}
 let H=ray.o+ray.d*marched.t;
 let depth=marched.plane.x+dot(H.xy-marched.pixel,marched.plane.yz);
 let hit=worldAt(H.xy,depth);
 let previous=reflectionView.radianceViewProj*vec4f(hit,1.0);
 if(previous.w<=0.0){return seen;}
 let Q=clipToFramebuffer(previous,reflectionView.radiance.xy).xy;
 let edge=reflectionEdgeFade(H.xy,size)*reflectionEdgeFade(Q,reflectionView.radiance.xy);
 let pixel=reflectionPixelAt(hit);
 let cone=reflectionConeAt(distance(hit,P),pixel,lobe);
 // How surely the hit is the screen's to answer: its share of the ray, the scene stage the rest.
 let trust=edge*reflectionLevelTrust(cone.level,reflectionView.radiance.z);
 if(!(trust>0.0)){return seen;}
 let ratio=size/reflectionView.radiance.xy;
 let toView=vec4f(marched.pixel-Q*ratio,vec2f(textureDimensions(reflectionImage))*ratio);
 // The hit's surface: its plane across the image, a footprint's width deep on either side.
 let surface=ReflectionSurface(marched.pixel,marched.plane,max(depth-screenBack(depth,cone.long,reflectionView.slab),REFLECTION_FLOOR));
 let taps=reflectionFootprint(Q,hit,pixel,lobe,cone,toView,surface);
 if(!(taps.color.a>0.0)){return seen;}
 seen.color=taps.color.rgb/taps.color.a;
 seen.confidence=trust*min(taps.color.a/taps.weight,1.0);
 seen.distance=distance(hit,P);
 return seen;
}`,
  )

/** The field's answer of a gather of the probes through a lobe (`reflectionFieldOver`, its mean and
 *  share as `reflectionProbesGathered` answers them): the probes added to the radiance around the
 *  scene as far as they answer, the surroundings alone past them. */
export const REFLECTION_FIELD_OVER_WGSL = wgslBlock(
  'REFLECTION_FIELD_OVER_WGSL',
  [REFLECTION_ENVIRONMENT_WGSL, REFLECTION_PROBES_SHARE_WGSL],
  `fn reflectionFieldOver(gathered:vec4f)->vec3f{
 return reflectionEnvironment()+reflectionProbesShare(gathered);
}`,
)

/** The chain's last stage (`reflectionField`), what a lobe reflects where neither the screen nor the
 *  proxy answered: the probes' field through the lobe added to the radiance around the scene, as far
 *  as the probes answer, the surroundings alone past them. The trace's rays end on it, and a forward
 *  fragment that is not the front surface reads it alone (`forwardTrace`, `weight.ts`). */
export const REFLECTION_FIELD_STAGE_WGSL = wgslBlock(
  'REFLECTION_FIELD_STAGE_WGSL',
  [REFLECTION_FIELD_OVER_WGSL, REFLECTION_PROBES_WGSL],
  `fn reflectionField(P:vec3f,N:vec3f,lobe:ReflectionLobe)->vec3f{
 return reflectionFieldOver(reflectionProbesGathered(P,N,lobe));
}`,
)

/** The chain's last stage through two lobes at the same point and normal, one gather of the probes
 *  (`reflectionFieldPair`): what `reflectionField` answers for each, a column each — the screen stage's. */
const REFLECTION_FIELD_PAIR_WGSL = wgslBlock(
  'REFLECTION_FIELD_PAIR_WGSL',
  [REFLECTION_FIELD_OVER_WGSL, REFLECTION_PROBES_PAIR_WGSL],
  `fn reflectionFieldPair(P:vec3f,N:vec3f,lobe:ReflectionLobe,other:ReflectionLobe)->mat2x3f{
 let gathered=reflectionProbesPairGathered(P,N,lobe,other);
 return mat2x3f(reflectionFieldOver(gathered[0]),reflectionFieldOver(gathered[1]));
}`,
)

/**
 * THE CHAIN IN TWO STAGES, each its own kernel (`trace.ts`): the screen first, the cheap answer for
 * every ray, and the scene after for the rays the screen left, so the costly walk runs on few threads. A ray's chain (`ReflectionChain`) carries what its
 * stages answered so far — the radiance, the share still unanswered (`rest`), the farthest the proxy
 * may walk (`bound`: the surface the screen met) and the distance of what answered the larger share
 * (`hit`, `REFLECTION_FAR` where none did yet: what the resolve reaches by,
 * `reflectionReuseReach`, `resolveWgsl.ts`). `reflectionTake` adds one answer to it.
 *
 * - `reflectionScreenStage`: the screen's answer along the lobe ray `lobe` (`sampleWgsl.ts`) of a
 *   surface at `P`, of normal `N`, seen from `V`; for a pixel past the near field (`far`), the field
 *   answers there all the screen left too, read in the one gather that reads the whole lobe's;
 * - `reflectionSceneStage`: what the screen left of a ray of a pixel in the near field
 *   (`reflectionNearField`, `reach.ts`), the proxy's answer (`reflectionProxied`), then, so the ray is
 *   whole, the environment's for the share the proxy's walk saw leave the scene (`open`), the field's
 *   for the rest (`reflectionFieldRest`): a pixel past the near field takes the field for all the screen
 *   left, in the screen stage.
 *
 * A lobe answers by its ray the share its roughness gives it (`reflectionTraceShare`), the field the
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
      REFLECTION_FIELD_PAIR_WGSL,
      REFLECTION_REACH_WGSL,
      REFLECTION_LOBE_RAY_WGSL,
      LOBE_AXIS_WGSL,
      REFLECTION_PROXY_WGSL,
    ],
    `struct ReflectionChain{radiance:vec3f,rest:f32,bound:f32,hit:f32,}
fn reflectionChainStart()->ReflectionChain{return ReflectionChain(vec3f(0.0),1.0,REFLECTION_FAR,REFLECTION_FAR);}
fn reflectionTake(ray:ptr<function,ReflectionChain>,answer:RadianceAnswer){
 (*ray).radiance+=(*ray).rest*answer.confidence*answer.color;
 if((*ray).hit>=REFLECTION_FAR&&answer.confidence>=0.5){(*ray).hit=answer.distance;}
 (*ray).rest*=1.0-answer.confidence;
}
/** The lobe a ray is read through: its direction and the thin lobe it carries. */
fn reflectionRayLobe(lobe:ReflectionLobeRay)->ReflectionLobe{return reflectionLobeOf(lobe.R,lobe.axis.w,lobe.axis);}
fn reflectionScreenStage(P:vec3f,N:vec3f,V:vec3f,lobe:ReflectionLobeRay,far:bool)->ReflectionChain{
 var ray=reflectionChainStart();
 // The share a ray answers (\`reflectionTraceShare\`); the field answers the rest, read through the
 // whole lobe: a lobe too rough to trace is the field's whole, and casts no ray.
 let share=reflectionTraceShare(lobe.width);
 ray.rest=share;
 if(share>0.0&&reflectionView.traced.x!=0u&&dot(N,V)>0.0){
  let seen=reflectionSeen(P,N,reflectionRayLobe(lobe),reflectionPixelAt(P));
  // The proxy walks no further than the surface the screen met.
  if(seen.confidence>0.0){ray.bound=seen.distance+REFLECTION_THICKNESS*reflectionPixelAt(P+lobe.R*seen.distance);}
  reflectionTake(&ray,seen);
 }
 // The field through the whole lobe for the share no ray answers and, past the near field, through
 // the ray's lobe for what the screen left: one gather where both read it.
 let whole=share<1.0;
 let left=far&&ray.rest>REFLECTION_EPSILON;
 if(whole){
  let wide=reflectionLobeOf(reflect(-V,N),lobe.alpha,vec4f(lobe.axis.xyz,lobe.along));
  if(left){
   let field=reflectionFieldPair(P,N,wide,reflectionRayLobe(lobe));
   ray.radiance=(1.0-share)*field[0]+ray.radiance;
   ray.radiance+=ray.rest*field[1];
  }else{
   ray.radiance=(1.0-share)*reflectionField(P,N,wide)+ray.radiance;
  }
 }else if(left){
  ray.radiance+=ray.rest*reflectionField(P,N,reflectionRayLobe(lobe));
 }
 if(far){ray.rest=0.0;}
 return ray;
}
fn reflectionFieldRest(P:vec3f,N:vec3f,lobe:ReflectionLobeRay,before:ReflectionChain)->ReflectionChain{
 var ray=before;
 if(ray.rest>REFLECTION_EPSILON){ray.radiance+=ray.rest*reflectionField(P,N,reflectionRayLobe(lobe));}
 ray.rest=0.0;
 return ray;
}
fn reflectionSceneStage(P:vec3f,N:vec3f,lobe:ReflectionLobeRay,screen:ReflectionChain)->ReflectionChain{
 var ray=screen;
 if(ray.rest>REFLECTION_EPSILON){
  let before=ray.rest;
  let proxied=reflectionProxied(P,N,reflectionRayLobe(lobe),ray.bound);
  reflectionTake(&ray,proxied.answer);
  // The share that left the scene sees the environment alone; the field stands for the rest.
  let open=min(before*proxied.open,ray.rest);
  ray.radiance+=open*reflectionEnvironment();
  ray.rest-=open;
 }
 return reflectionFieldRest(P,N,lobe,ray);
}`,
  )
