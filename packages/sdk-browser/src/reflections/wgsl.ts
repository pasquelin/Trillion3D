import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { REFLECTION_ENVIRONMENT_WGSL, REFLECTION_PROBES_WGSL } from './field.ts'
import { reflectionFootprintWgsl } from './footprint.ts'
import { reflectionRayWgsl } from './ray.ts'
import { reflectionProxyWgsl } from './proxy.ts'
import { REFLECTION_DEPTH_BINDING } from './viewLayout.ts'
import { SCREEN_MARCH_WGSL } from '../gpu/hiz/screenMarch.ts'
import type { RuntimeBindings } from '../bounce/runtimeTraceWgsl.ts'

/**
 * THE REFLECTION: ONE SYSTEM FOR EVERY SURFACE. What a surface reflects along its mirror direction
 * `R` is one function, `reflectedRadiance`, every program shares — the opaque surfaces in one
 * compute pass (`trace.ts`), the blended surfaces and the water inline in their fragment stage
 * (`weight.ts`) — and it reads what the view holds: its depth, the previous lit image of the same
 * view, the resident proxy and the bounce probes, and the environment. It is one chain of
 * answers, each carrying the share of the radiance it is sure of, and giving the rest to the next:
 *
 *   L = Cs·Ls + (1 − Cs)·(Cp·Lp + (1 − Cp)·(Cf·Lf + (1 − Cf)·Le))
 *
 * - the screen (`reflectionSeen`): the previous lit image, at the point the ray meets in the depth;
 * - the proxy (`reflectionProxied`): the scene's coarse geometry, past what the screen sees;
 * - the field (`reflectionProbesGathered` over `reflectionEnvironment`): the bounce probes' radiance
 *   through the lobe, on the radiance around the scene, where the probes reach;
 * - the environment (`reflectionEnvironment`): what is around the scene, the last word.
 *
 * Every confidence is continuous in what it reads, there is no hit or miss: a stage whose share
 * of the radiance is left under `REFLECTION_EPSILON` is not evaluated. Nothing of the chain reads a
 * count of images, a seed or a history of its own, so two images of a still view give the same
 * bits — but the run-time proxy's stage, in the opaque trace alone (`reflectionProxyWgsl`): its
 * frame has a budget, and the rays it leaves out go on in the next images from the answer they last got
 * (`bounce/runtimeTraceWgsl.ts`, `proxyHistory.ts`); a still view reaches the same bits once none
 * is left, which is what its settling waits for (`settle.ts`).
 *
 * - `gpu/hiz/screenMarch.ts`: the engine's hierarchical march of the depth pyramid, and where it hits;
 * - `footprint.ts`: the cone of the lobe, the footprint it reads of the radiance pyramid
 *   (`radiance.ts`), and the fades that make the screen's answer a confidence;
 * - `proxy.ts`: the proxy's answer;
 * - `field.ts`: the lobe, the environment and the probes through it;
 * - `weight.ts`: what a surface keeps of the radiance, and how each program binds it;
 * - this file: `reflectionSeen`, the screen's answer along the lobe's centre, and
 *   `reflectedRadiance`, the chain.
 */

/** `reflectionSeen`: the screen's answer to a surface at `P`, of normal `N`, reflecting through
 *  `lobe` — the march along its centre, the hit on its plane, its footprint (`reflectionFootprint`)
 *  and its confidence: the fades of the image's border (in this image and in the one the radiance
 *  is read from), of the footprint's pyramid level (`reflectionLevelTrust`) and of the screen
 *  distance (the march covers `REFLECTION_STEP_CAP` pixels, and the next stage the rest), times the
 *  share of the depth-weighted reads the image covers. A hit has no fade of its own, neither by its
 *  depth in the slab nor by the side its plane faces: either gate turns on and off between
 *  neighbouring pixels at a thin surface, whose plane and slab depth jump from one to the next,
 *  and breaks the reflection of a body the ray passes through into shards of its edges. */
const reflectionSeenWgsl = (group: number) =>
  wgslBlock(
    `reflectionSeenWgsl(${group})`,
    [
      reflectionFootprintWgsl(group),
      reflectionRayWgsl(group),
      SCREEN_MARCH_WGSL(group, REFLECTION_DEPTH_BINDING),
      clipToFramebuffer,
    ],
    `struct ReflectionSeen{color:vec3f,confidence:f32,}
fn reflectionSeen(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionSeen{
 var seen=ReflectionSeen(vec3f(0.0),0.0);
 let size=view.viewport.xy;
 let scale=reflectionView.slab.x;
 let ray=reflectionRay(P,N,lobe);
 let marched=screenMarch(ray.o,ray.d,ray.end,REFLECTION_THICKNESS,reflectionView.slab);
 if(marched.t<0.0||marched.plane.x<=0.0){return seen;}
 let H=ray.o+ray.d*marched.t;
 let depth=marched.plane.x+dot(H.xy-marched.pixel,marched.plane.yz);
 let hit=worldAt(H.xy,depth);
 let previous=reflectionView.radianceViewProj*vec4f(hit,1.0);
 if(previous.w<=0.0){return seen;}
 let Q=clipToFramebuffer(previous,reflectionView.radiance.xy).xy;
 let edge=reflectionEdgeFade(H.xy,size)*reflectionEdgeFade(Q,reflectionView.radiance.xy);
 let pixel=(reflectionView.viewProj*vec4f(hit,1.0)).w*scale;
 let cone=reflectionConeAt(distance(hit,P),pixel,lobe);
 let travel=abs(H.x-ray.o.x)+abs(H.y-ray.o.y);
 let confidence=edge
  *reflectionLevelTrust(cone.level,reflectionView.radiance.z)
  *(1.0-smoothstep(0.5*REFLECTION_STEP_CAP,REFLECTION_STEP_CAP,travel));
 if(confidence==0.0){return seen;}
 let ratio=size/reflectionView.radiance.xy;
 let toView=vec4f(marched.pixel-Q*ratio,vec2f(textureDimensions(reflectionRadiance))*ratio);
 // The hit's surface: its plane across the image, a footprint's width deep on either side.
 let surface=ReflectionSurface(marched.pixel,marched.plane,max(depth-screenBack(depth,cone.long,reflectionView.slab),1e-30));
 let taps=reflectionFootprint(Q,hit,pixel,lobe,cone,toView,surface);
 if(!(taps.color.a>0.0)){return seen;}
 seen.color=taps.color.rgb/taps.color.a;
 seen.confidence=confidence*min(taps.color.a/taps.weight,1.0);
 return seen;
}`,
  )

/**
 * `reflectedRadiance`: the radiance a surface at `P`, of normal `N` and roughness `rough`, seen
 * from `V`, reflects through `lobe` — the one function of every program, the chain of the
 * answers above. `lobe` is the lobe's long axis: its direction (`xyz`, any on a round lobe) and its
 * α along it (`w`; the roughness's α on a round lobe, `lobeAlpha`): the material's anisotropic GGX
 * parameters (`reflectionLobeOf`).
 */
export const reflectedRadianceWgsl = (group: number, runtime?: RuntimeBindings) =>
  wgslBlock(
    `reflectedRadianceWgsl(${group}, ${runtime ? 'runtime' : 'cooked'})`,
    [
      reflectionSeenWgsl(group),
      reflectionProxyWgsl(group, runtime),
      REFLECTION_ENVIRONMENT_WGSL,
      REFLECTION_PROBES_WGSL,
      LOBE_AXIS_WGSL,
    ],
    `fn reflectedRadiance(P:vec3f,N:vec3f,V:vec3f,rough:f32,lobe:vec4f)->vec3f{
 let ellipse=reflectionLobeOf(reflect(-V,N),lobeAlpha(rough),lobe);
 var radiance=vec3f(0.0);
 var rest=1.0;
 if(reflectionView.traced.x!=0u&&dot(N,V)>0.0){
  let seen=reflectionSeen(P,N,ellipse);
  radiance+=rest*seen.confidence*seen.color;
  rest*=1.0-seen.confidence;
 }
 if(rest>REFLECTION_EPSILON){
  let proxied=reflectionProxied(P,N,ellipse);
  radiance+=rest*proxied.confidence*proxied.color;
  rest*=1.0-proxied.confidence;
 }
 if(rest>REFLECTION_EPSILON){
  let around=reflectionEnvironment(ellipse);
  let gathered=reflectionProbesGathered(P,N,ellipse);
  let confidence=min(gathered.w,1.0);
  radiance+=rest*(confidence*(around+gathered.xyz)+(1.0-confidence)*around);
 }
 return radiance;
}`,
  )
