import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_CONE_WGSL } from './footprint.ts'
import { REFLECTION_DEPTH_BINDING, reflectionBindingsWgsl } from './viewLayout.ts'
import { SCREEN_MARCH_WGSL } from '../gpu/hiz/screenMarch.ts'

/**
 * The screen ray of a reflection (`reflectionRay`): its origin, its direction to the far end of its
 * reach, and how far along it the march goes (`end`: the image's edge, `screenMarchEnd`, or
 * `REFLECTION_STEP_CAP` pixels of L1 length at most). It leaves the surface one pixel off along its
 * normal: a ray never starts inside the depth it leaves.
 * `reflectionReach`: the world distance along a reflected ray, from its origin `A` (clip) along
 * `toward` (clip), to which the screen can answer: where it meets the near plane, or where the
 * lobe's footprint grows to the radiance pyramid's top level — the widest short axis, or the long
 * axis's share of the taps, 2 · s · tan = 2^top pixels, a pixel `scale · w` wide at the clip `w`
 * of the point, which grows along the ray at `toward.w` —, past which `reflectionLevelTrust` is
 * zero. A mirror's reach is the near plane's, or `REFLECTION_FAR`.
 */
export const reflectionRayWgsl = (group: number) =>
  wgslBlock(
    `reflectionRayWgsl(${group})`,
    [
      reflectionBindingsWgsl(group),
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_CONE_WGSL,
      REFLECTION_LOBE_WGSL,
      clipToFramebuffer,
      SCREEN_MARCH_WGSL(group, REFLECTION_DEPTH_BINDING),
    ],
    `fn reflectionReach(A:vec4f,toward:vec4f,lobe:ReflectionLobe)->f32{
 let grow=toward.z-toward.w;
 let near=select(REFLECTION_FAR,(A.w-A.z)/grow,grow>0.0);
 let tangent=max(reflectionConeTangent(lobe.widths.x),reflectionConeTangent(lobe.widths.y)/REFLECTION_TAPS);
 let top=exp2(reflectionView.radiance.z)*reflectionView.slab.x;
 let room=2.0*tangent-top*toward.w;
 return min(near,select(REFLECTION_FAR,top*A.w/room,room>0.0));
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
 let end=min(screenMarchEnd(S0.xy,d.xy,size),REFLECTION_STEP_CAP/max(abs(d.x)+abs(d.y),1e-6));
 return ReflectionRay(S0,d,end);
}`,
  )
