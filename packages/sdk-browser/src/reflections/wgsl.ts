import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { REFLECTION_ENVIRONMENT_WGSL, REFLECTION_PROBES_WGSL } from './field.ts'
import { reflectionFootprintWgsl } from './footprint.ts'
import { reflectionGeometryWgsl } from './geometry.ts'
import { REFLECTION_MARCH_WGSL } from './march.ts'
import { reflectionProxyWgsl } from './proxy.ts'

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
 * bits.
 *
 * - `march.ts`: the hierarchical march of the depth pyramid, and where it hits;
 * - `footprint.ts`: the cone of the lobe, the footprint it reads of the radiance pyramid
 *   (`radiance.ts`), and the fades that make the screen's answer a confidence;
 * - `proxy.ts`: the proxy's answer;
 * - `field.ts`: the lobe, the environment and the probes through it;
 * - `weight.ts`: what a surface keeps of the radiance, and how each program binds it;
 * - this file: `reflectionSeen`, the screen's answer along the lobe's centre, and
 *   `reflectedRadiance`, the chain.
 */

/** `reflectionReach`: the world distance along a reflected ray, from its origin `A` (clip) along
 *  `toward` (clip), to which the screen can answer: where it meets the near plane, or where the
 *  lobe's footprint grows to the radiance pyramid's top level — the widest short axis, or the long
 *  axis's share of the taps, 2 · s · tan = 2^top pixels, a pixel `scale · w` wide at the clip `w`
 *  of the point, which grows along the ray at `toward.w` —, past which `reflectionLevelTrust` is
 *  zero. A mirror's reach is the near plane's, or `REFLECTION_FAR`.
 *  `reflectionRay`: the screen ray of a reflection — its origin, its direction to the far end of its
 *  reach, and how far along it the march goes, within `REFLECTION_STEP_CAP` pixels.
 *  `reflectionHitNormal`: the normal of the pixel plane the ray stopped in, turned to the eye.
 *  `reflectionSeen`: the screen's answer to a surface at `P`, of normal `N`, reflecting through
 *  `lobe` — the march along its centre, the hit on its plane, its footprint (`reflectionFootprint`)
 *  and its confidence: the fades of the image's border (in this image and in the one the radiance
 *  is read from), of the footprint's pyramid level (`reflectionLevelTrust`), of the depth into the
 *  hit's slab (a ray that meets a surface near its back hits it less surely), of the side the hit
 *  surface faces and of the screen distance (the march covers `REFLECTION_STEP_CAP` pixels, and the
 *  next stage the rest), times the share of the depth-weighted reads the image covers. */
const reflectionSeenWgsl = (group: number) =>
  wgslBlock(
    `reflectionSeenWgsl(${group})`,
    [
      reflectionFootprintWgsl(group),
      reflectionGeometryWgsl(group),
      REFLECTION_MARCH_WGSL(group),
      clipToFramebuffer,
    ],
    `struct ReflectionSeen{color:vec3f,confidence:f32,}
fn reflectionReach(A:vec4f,toward:vec4f,lobe:ReflectionLobe)->f32{
 let grow=toward.z-toward.w;
 let near=select(REFLECTION_FAR,(A.w-A.z)/grow,grow>0.0);
 let tangent=max(reflectionConeTangent(lobe.widths.x),reflectionConeTangent(lobe.widths.y)/REFLECTION_TAPS);
 let top=exp2(reflectionView.radiance.z)*reflectionView.slab.x;
 let room=2.0*tangent-top*toward.w;
 return min(near,select(REFLECTION_FAR,top*A.w/room,room>0.0));
}
fn reflectionHitNormal(hit:ReflectionHit)->vec3f{
 let x=vec2f(1.0,0.0);let y=vec2f(0.0,1.0);
 let centre=worldAt(hit.pixel,hit.plane.x);
 let n=normalize(cross(worldAt(hit.pixel+x,hit.plane.x+hit.plane.y)-centre,worldAt(hit.pixel+y,hit.plane.x+hit.plane.z)-centre));
 return select(-n,n,dot(n,viewToEye(centre))>0.0);
}
struct ReflectionRay{o:vec3f,d:vec3f,end:f32,}
fn reflectionRay(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionRay{
 let size=view.viewport.xy;
 // One pixel off the surface along its normal: a ray never starts inside the depth it leaves.
 let origin=P+N*((reflectionView.viewProj*vec4f(P,1.0)).w*reflectionView.slab.x);
 let A=reflectionView.viewProj*vec4f(origin,1.0);
 let toward=reflectionView.viewProj*vec4f(lobe.R,0.0);
 let S0=clipToFramebuffer(A,size);
 let d=clipToFramebuffer(A+toward*reflectionReach(A,toward,lobe),size)-S0;
 let end=min(reflectionScreenEnd(S0.xy,d.xy,size),REFLECTION_STEP_CAP/max(abs(d.x)+abs(d.y),1e-6));
 return ReflectionRay(S0,d,end);
}
fn reflectionSeen(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionSeen{
 var seen=ReflectionSeen(vec3f(0.0),0.0);
 let size=view.viewport.xy;
 let scale=reflectionView.slab.x;
 let ray=reflectionRay(P,N,lobe);
 let marched=reflectionMarch(ray.o,ray.d,ray.end);
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
  *(1.0-smoothstep(0.5,1.0,marched.into))
  *smoothstep(0.0,0.25,-dot(reflectionHitNormal(marched),lobe.R))
  *(1.0-smoothstep(0.5*REFLECTION_STEP_CAP,REFLECTION_STEP_CAP,travel));
 if(confidence==0.0){return seen;}
 let ratio=size/reflectionView.radiance.xy;
 let toView=vec4f(marched.pixel-Q*ratio,vec2f(textureDimensions(reflectionRadiance))*ratio);
 // The hit's surface: its plane across the image, a footprint's width deep on either side.
 let surface=ReflectionSurface(marched.pixel,marched.plane,max(depth-reflectionBack(depth,cone.long),1e-30));
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
export const reflectedRadianceWgsl = (group: number) =>
  wgslBlock(
    `reflectedRadianceWgsl(${group})`,
    [
      reflectionSeenWgsl(group),
      reflectionProxyWgsl(group),
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
