/**
 * THE REFLECTION: ONE SYSTEM FOR EVERY SURFACE. What a surface reflects along its mirror direction
 * `R` is one function, `reflectedRadianceAlong`, every program shares — the opaque surfaces in one
 * compute pass (`trace.ts`), the transparents' front surface in the same pass (`frontLayer.ts`), the
 * blended surfaces and the water behind it inline in their fragment stage (`weight.ts`) — and it reads
 * what the view holds: its depth, the previous lit image of the same view, the resident proxy and the
 * bounce probes, and the environment. It is one chain of
 * answers, each carrying the share of the radiance it is sure of, and giving the rest to the next:
 *
 *   L = Cs·Ls + (1 − Cs)·(Cp·Lp + (1 − Cp)·(Cf·Lf + (1 − Cf)·Le))
 *
 * - the screen (`reflectionSeen`): the previous lit image, at the point the ray meets in the depth;
 * - the proxy (`reflectionProxied`): the scene's coarse geometry, past what the screen sees, one ray a
 *   lobe the screen left, in the trace's kernels — the reflection group binds it to the compute stage
 *   (`REFLECTION_SCENE_BINDINGS`); a forward fragment reads the trace's front layer, or the field;
 * - the field (`reflectionProbesGathered` over `reflectionEnvironment`): the bounce probes' radiance
 *   through the lobe added to the radiance around the scene, `Lf = Le + Lg`, where the probes reach —
 *   so that the chain's last two stages are `Le + Cf·Lg`, the environment always under the probes;
 * - the environment (`reflectionEnvironment`): the background the screen draws around the scene,
 *   as radiance, the last word.
 *
 * Every confidence is continuous in what it reads: a stage whose share of the radiance is left under
 * `REFLECTION_EPSILON` is not evaluated. The screen's confidence, in every program, is taken whole or
 * not at all, as often as it holds (`reflectionDither`, a hash of the point, the ray and the image's
 * turn): its mean over the images — the trace's history, the temporal accumulation over the forward
 * fragments — is the continuous chain's, and the proxy walks for the rays the screen leaves alone, never for the sliver a sure hit leaves, and no
 * further than the surface the screen met (`bound`). The chain reads no history of its own, so two
 * images of a still view — its turn held — give the same bits.
 *
 * - `gpu/hiz/screenMarch.ts`: the engine's hierarchical march of the depth pyramid, and where it hits;
 * - `footprint.ts`: the cone of the lobe, the footprint it reads of the radiance pyramid
 *   (`radiance.ts`), and the fades that make the screen's answer a confidence;
 * - `proxy.ts`: the proxy's answer;
 * - `field.ts`: the lobe, the environment and the probes through it;
 * - `weight.ts`: what a surface keeps of the radiance, and how each program binds it;
 * - this file: `reflectionSeen`, the screen's answer along the lobe's centre, and
 *   `reflectedRadianceAlong`, the chain.
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { REFLECTION_ENVIRONMENT_WGSL, REFLECTION_PROBES_WGSL } from './field.ts'
import { reflectionFootprintWgsl } from './footprint.ts'
import { reflectionRayWgsl } from './ray.ts'
import { reflectionProxyWgsl } from './proxy.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_DEPTH_BINDING } from './viewLayout.ts'
import { SCREEN_MARCH_WGSL } from '../gpu/hiz/screenMarch.ts'
import { RADIANCE_ANSWER } from '../bounce/runtimeRadianceWgsl.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { REFLECTION_DITHER_WGSL } from './sampleWgsl.ts'

/** `reflectionSeen`: the screen's answer to a surface at `P`, of normal `N`, reflecting through
 *  `lobe` — the march along its centre, as coarse as a cone widening by `spread` a pixel allows
 *  (`screenMarch`), the hit on its plane, its footprint (`reflectionFootprint`)
 *  and its confidence: whether the screen answers — the fades of the image's border (in this image and
 *  in the one the radiance is read from) and of the footprint's pyramid level (`reflectionLevelTrust`),
 *  taken whole or not at all as often as they hold (`reflectionDither`) —, then the share of the
 *  depth-weighted reads the image covers, continuous: a bright body's silhouette is a partial answer,
 *  never a dithered one. The march's budget cuts no ray (`screenMarch`'s floor level). A hit has no fade of its own, neither by its
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
      REFLECTION_DITHER_WGSL,
    ],
    `fn reflectionSeen(P:vec3f,N:vec3f,lobe:ReflectionLobe,surfacePixel:f32,spread:f32)->RadianceAnswer{
 var seen=RadianceAnswer(vec3f(0.0),0.0,0.0);
 let size=view.viewport.xy;
 let ray=reflectionRay(P,N,lobe,surfacePixel);
 let marched=screenMarch(ray.o,ray.d,ray.end,REFLECTION_THICKNESS,reflectionView.slab,REFLECTION_MARCH_STEPS,spread);
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
 // Whether the hit is the screen's to answer, taken whole or not at all as often as it is sure.
 let trust=edge*reflectionLevelTrust(cone.level,reflectionView.radiance.z);
 if(!(reflectionDither(P,lobe.R,0u)<trust)){return seen;}
 let ratio=size/reflectionView.radiance.xy;
 let toView=vec4f(marched.pixel-Q*ratio,vec2f(textureDimensions(reflectionImage))*ratio);
 // The hit's surface: its plane across the image, a footprint's width deep on either side.
 let surface=ReflectionSurface(marched.pixel,marched.plane,max(depth-screenBack(depth,cone.long,reflectionView.slab),REFLECTION_FLOOR));
 let taps=reflectionFootprint(Q,hit,pixel,lobe,cone,toView,surface);
 if(!(taps.color.a>0.0)){return seen;}
 seen.color=taps.color.rgb/taps.color.a;
 seen.confidence=min(taps.color.a/taps.weight,1.0);
 seen.distance=distance(hit,P);
 return seen;
}`,
  )

/** The chain's last stage (`reflectionField`), what a lobe reflects where neither the screen nor the
 *  proxy answered: the probes' field through the lobe added to the radiance around the scene, as far
 *  as the probes answer, the surroundings alone past them. The trace's rays end on it, and a forward
 *  fragment that is not the front surface reads it alone (`forwardTrace`, `weight.ts`). */
export const REFLECTION_FIELD_STAGE_WGSL = wgslBlock(
  'REFLECTION_FIELD_STAGE_WGSL',
  [REFLECTION_ENVIRONMENT_WGSL, REFLECTION_PROBES_WGSL],
  `fn reflectionField(P:vec3f,N:vec3f,lobe:ReflectionLobe)->vec3f{
 let around=reflectionEnvironment();
 let gathered=reflectionProbesGathered(P,N,lobe);
 let confidence=min(gathered.w,1.0);
 return confidence*(around+gathered.xyz)+(1.0-confidence)*around;
}`,
)

/**
 * `reflectedRadianceAlong`: the radiance a surface at `P`, of normal `N`, seen from `V`, reflects
 * along `R` through a lobe of width `alpha` — the one function of every program, the chain of the
 * answers above. `lobe` is the lobe's long axis: its direction (`xyz`, any on a round lobe) and its
 * α along it (`w`; `alpha` on a round lobe): the material's anisotropic GGX parameters
 * (`reflectionLobeOf`). It leaves in `reflectionHit` the distance of what answered the larger share
 * of it — the screen's hit or the proxy's —, `REFLECTION_FAR` where the field and the environment
 * did: what the spatial reuse reaches by (`reflectionReuseReach`, `spatialWgsl.ts`); and in
 * `reflectionDirection` the direction it traced, which the reuse weighs the ray by.
 * `width` is the α of the lobe the ray stands for — its own, or the whole lobe a thin sample of it is
 * drawn from (`sampleWgsl.ts`) —: how far the proxy's ray goes before the field holds that lobe
 * (`reflectionProxyReach`). The `// @cut` lines are the bench's cut points (`bench/dawn/shaderCuts.ts`):
 * comments, nothing the engine runs.
 */
export const reflectedRadianceWgsl = (group: number) =>
  wgslBlock(
    `reflectedRadianceWgsl(${group})`,
    [
      reflectionSeenWgsl(group),
      reflectionProxyWgsl(group),
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_FIELD_STAGE_WGSL,
      REFLECTION_CONE_WGSL,
      LOBE_AXIS_WGSL,
    ],
    `var<private> reflectionHit:f32;
var<private> reflectionDirection:vec3f;
/** One stage of the chain: its answer's share of what is left added, \`reflectionHit\` its distance
 *  where it takes the larger share, what is left reduced. */
fn reflectionTake(answer:RadianceAnswer,radiance:ptr<function,vec3f>,rest:ptr<function,f32>){
 *radiance+=*rest*answer.confidence*answer.color;
 if(*rest>0.5&&*rest*(1.0-answer.confidence)<=0.5){reflectionHit=answer.distance;}
 *rest*=1.0-answer.confidence;
}
fn reflectedRadianceAlong(P:vec3f,N:vec3f,V:vec3f,R:vec3f,alpha:f32,lobe:vec4f,width:f32)->vec3f{
 let ellipse=reflectionLobeOf(R,alpha,lobe);
 var radiance=vec3f(0.0);
 var rest=1.0;
 reflectionHit=REFLECTION_FAR;
 reflectionDirection=R;
 let pixel=reflectionPixelAt(P);
 var bound=REFLECTION_FAR;
 if(reflectionView.traced.x!=0u&&dot(N,V)>0.0){
  var onScreen=reflectionSeen(P,N,ellipse,pixel,2.0*reflectionConeTangent(width));
  // The proxy walks no further than the surface the screen met.
  if(onScreen.confidence>0.0){bound=onScreen.distance+REFLECTION_THICKNESS*reflectionPixelAt(P+R*onScreen.distance);}
  reflectionTake(onScreen,&radiance,&rest);
 }
 // @cut screen -> radiance+vec3f(rest) keep: ;
 if(rest>REFLECTION_EPSILON){reflectionTake(reflectionProxied(P,N,ellipse,pixel,width,bound),&radiance,&rest);}
 // @cut proxy -> radiance+vec3f(rest) keep: ;
 if(rest>REFLECTION_EPSILON){radiance+=rest*reflectionField(P,N,ellipse);}
 return radiance;
}`,
  )
