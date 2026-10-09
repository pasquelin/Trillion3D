import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer, pixelToNdc, unprojectPoint } from '../../../math/src/wgsl/projection.ts'
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstantsWgsl.ts'
import { reflectionFieldWgsl } from './field.ts'
import { reflectionFootprintWgsl } from './footprint.ts'
import { REFLECTION_MARCH_WGSL } from './march.ts'

/**
 * THE REFLECTION: ONE SYSTEM FOR EVERY SURFACE. What a surface reflects along its mirror direction
 * `R` is one function, `reflectedRadiance`, every program shares — the opaque surfaces in one
 * compute pass (`trace.ts`), the blended surfaces and the water inline in their fragment stage
 * (`weight.ts`) — and it reads three things of the view: its depth, the previous lit image of the
 * same view, and the radiance around the scene. It is mix(field, hit radiance, confidence), a
 * function of its inputs alone: nothing of it reads a frame index, a seed or a history of its
 * own, so two images of a still view give the same bits.
 *
 * - `march.ts`: the hierarchical march of the depth pyramid, and where it hits;
 * - `footprint.ts`: the cone of the lobe, the footprint it reads of the radiance pyramid
 *   (`radiance.ts`), and the fades that make the screen's answer a confidence;
 * - `field.ts`: the lobe, and the radiance field a miss reads — the environment and the bounce
 *   probes — through it;
 * - `weight.ts`: what a surface keeps of the radiance, and how each program binds it;
 * - this file: `reflectionSeen`, the screen's answer along the lobe's centre, and
 *   `reflectedRadiance`, the whole.
 */

/**
 * The view's geometry: the world point of a pixel at a depth (`reflectionWorldAt`), the direction
 * from a point to the eye (`reflectionToEye`) and a slab (`reflectionSlab`): the reversed depths of
 * the point `thickness` behind a point and `thickness` in front of it along the eye's ray.
 */
const REFLECTION_GEOMETRY_WGSL = wgslBlock(
  'REFLECTION_GEOMETRY_WGSL',
  [pixelToNdc, unprojectPoint],
  `fn reflectionWorldAt(pixel:vec2f,z:f32)->vec3f{
 return unprojectPoint(reflectionView.inverseViewProj,vec3f(pixelToNdc(pixel,reflectionView.screen.xy),z));
}
fn reflectionToEye(P:vec3f)->vec3f{return normalize(reflectionView.camera.xyz-P*reflectionView.camera.w);}
fn reflectionSlab(P:vec3f,thickness:f32)->vec2f{
 let toward=reflectionToEye(P)*thickness;
 let back=reflectionView.viewProj*vec4f(P-toward,1.0);
 let front=reflectionView.viewProj*vec4f(P+toward,1.0);
 return vec2f(back.z/back.w,front.z/max(front.w,1e-30));
}`,
)

/** `reflectionReach`: the world distance along a reflected ray, from its origin `A` (clip) along
 *  `toward` (clip), to which the screen can answer: where it meets the near plane, or where the
 *  lobe's footprint grows to the radiance pyramid's top level — the widest short axis, or the long
 *  axis's share of the taps, 2 · s · tan = 2^top pixels, a pixel `scale · w` wide at the clip `w`
 *  of the point, which grows along the ray at `toward.w` —, past which `reflectionLevelTrust` is
 *  zero. A mirror's reach is the near plane's, or `REFLECTION_FAR`.
 *  `reflectionSeen`: the screen's answer to a surface at `P`, of normal `N`, reflecting through
 *  `lobe` — the march along its centre, the hit on its plane, its footprint (`reflectionFootprint`)
 *  and its confidence: the fades of the image's border (in this image and in the one the radiance
 *  is read from) and of the footprint's pyramid level (`reflectionLevelTrust`), times the share of
 *  the depth-weighted reads the image covers. */
const reflectionSeenWgsl = (group: number) =>
  wgslBlock(
    `reflectionSeenWgsl(${group})`,
    [
      reflectionFootprintWgsl(group),
      REFLECTION_GEOMETRY_WGSL,
      REFLECTION_MARCH_WGSL,
      clipToFramebuffer,
    ],
    `struct ReflectionSeen{color:vec3f,confidence:f32,}
fn reflectionReach(A:vec4f,toward:vec4f,lobe:ReflectionLobe)->f32{
 let grow=toward.z-toward.w;
 let near=select(REFLECTION_FAR,(A.w-A.z)/grow,grow>0.0);
 let tangent=max(reflectionConeTangent(lobe.widths.x),reflectionConeTangent(lobe.widths.y)/REFLECTION_TAPS);
 let top=exp2(reflectionView.radiance.z)*reflectionView.screen.z;
 let room=2.0*tangent-top*toward.w;
 return min(near,select(REFLECTION_FAR,top*A.w/room,room>0.0));
}
fn reflectionSeen(P:vec3f,N:vec3f,lobe:ReflectionLobe)->ReflectionSeen{
 var seen=ReflectionSeen(vec3f(0.0),0.0);
 let size=reflectionView.screen.xy;
 let scale=reflectionView.screen.z;
 // One pixel off the surface along its normal: a ray never starts inside the depth it leaves.
 let origin=P+N*((reflectionView.viewProj*vec4f(P,1.0)).w*scale);
 let A=reflectionView.viewProj*vec4f(origin,1.0);
 let toward=reflectionView.viewProj*vec4f(lobe.R,0.0);
 let S0=clipToFramebuffer(A,size);
 let d=clipToFramebuffer(A+toward*reflectionReach(A,toward,lobe),size)-S0;
 let marched=reflectionMarch(S0,d,reflectionScreenEnd(S0.xy,d.xy,size));
 if(marched.t<0.0||marched.plane.x<=0.0){return seen;}
 let H=S0+d*marched.t;
 let hit=reflectionWorldAt(H.xy,marched.plane.x+dot(H.xy-marched.pixel,marched.plane.yz));
 let previous=reflectionView.radianceViewProj*vec4f(hit,1.0);
 if(previous.w<=0.0){return seen;}
 let Q=clipToFramebuffer(previous,reflectionView.radiance.xy).xy;
 let edge=reflectionEdgeFade(H.xy,size)*reflectionEdgeFade(Q,reflectionView.radiance.xy);
 let pixel=(reflectionView.viewProj*vec4f(hit,1.0)).w*scale;
 let cone=reflectionConeAt(distance(hit,P),pixel,lobe);
 let confidence=edge*reflectionLevelTrust(cone.level,reflectionView.radiance.z);
 if(confidence==0.0){return seen;}
 let ratio=size/reflectionView.radiance.xy;
 let toView=vec4f(marched.pixel-Q*ratio,vec2f(textureDimensions(reflectionRadiance))*ratio);
 // The hit's surface: its plane across the image, a footprint's width deep on either side.
 let slab=reflectionSlab(hit,pixel*cone.long);
 let surface=ReflectionSurface(marched.pixel,marched.plane,0.5*(slab.y-slab.x));
 let taps=reflectionFootprint(Q,hit,pixel,lobe,cone,toView,surface);
 if(!(taps.color.a>0.0)){return seen;}
 seen.color=taps.color.rgb/taps.color.a;
 seen.confidence=confidence*min(taps.color.a/taps.weight,1.0);
 return seen;
}`,
  )

/**
 * `reflectedRadiance`: the radiance a surface at `P`, of normal `N` and roughness `rough`, seen
 * from `V`, reflects — the one function of every program, each of which binds the bounce
 * cascades: the field (`reflectionField`) where the screen does not answer, the screen's answer
 * (`reflectionSeen`) where it does, by its confidence. `lobe` is the lobe's long axis: its direction (`xyz`, any on a
 * round lobe) and its α along it (`w`; rough² on a round lobe), the material's anisotropic GGX
 * parameters (`reflectionLobe`).
 */
export const reflectedRadianceWgsl = (group: number) =>
  wgslBlock(
    `reflectedRadianceWgsl(${group})`,
    [reflectionSeenWgsl(group), reflectionFieldWgsl(true), ROUGHNESS_FLOOR],
    `fn reflectedRadiance(P:vec3f,N:vec3f,V:vec3f,rough:f32,lobe:vec4f)->vec3f{
 let r=clamp(rough,ROUGHNESS_FLOOR,1.0);
 let ellipse=reflectionLobeOf(reflect(-V,N),r*r,lobe);
 let field=reflectionField(P,N,ellipse);
 if(reflectionView.counts.x==0u||dot(N,V)<=0.0){return field;}
 let seen=reflectionSeen(P,N,ellipse);
 return mix(field,seen.color,seen.confidence);
}`,
  )
