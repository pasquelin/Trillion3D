import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../../math/src/wgsl/projection.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_DEPTH_BINDING, reflectionBindingsWgsl } from './viewLayout.ts'
import { SCREEN_MARCH_WGSL } from '../../visibility/hiz/gpu/screenMarch.ts'

/**
 * The screen ray of a reflection (`reflectionRay`): its origin, its direction to the far end of its
 * reach, and how far along it the march goes (`end`: the image's edge, `screenMarchEnd`: the march's
 * hierarchy crosses empty screen in a few iterations, and `reflectionScreenSteps` bounds it, `ReflectionView.scene`). It leaves the surface one pixel off along its
 * normal — `pixel`, the world size of a pixel at `P` (`reflectionPixelAt`) —: a ray never starts
 * inside the depth it leaves.
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
      REFLECTION_LOBE_WGSL,
      clipToFramebuffer,
      SCREEN_MARCH_WGSL(group, REFLECTION_DEPTH_BINDING),
    ],
    `fn reflectionReach(A:vec4f,toward:vec4f,lobe:ReflectionLobe)->f32{
 let grow=toward.z-toward.w;
 let near=select(REFLECTION_FAR,(A.w-A.z)/grow,grow>0.0);
 let tangent=reflectionReadTangent(lobe);
 let top=exp2(reflectionView.radiance.z)*reflectionView.slab.x;
 let room=2.0*tangent-top*toward.w;
 return min(near,select(REFLECTION_FAR,top*A.w/room,room>0.0));
}
struct ReflectionRay{o:vec3f,d:vec3f,end:f32,}
fn reflectionRay(P:vec3f,N:vec3f,lobe:ReflectionLobe,pixel:f32)->ReflectionRay{
 let size=view.viewport.xy;
 // One pixel off the surface along its normal: a ray never starts inside the depth it leaves.
 let origin=P+N*pixel;
 let A=reflectionView.viewProj*vec4f(origin,1.0);
 let toward=reflectionView.viewProj*vec4f(lobe.R,0.0);
 let S0=clipToFramebuffer(A,size);
 let d=clipToFramebuffer(A+toward*reflectionReach(A,toward,lobe),size)-S0;
 let end=screenMarchEnd(S0.xy,d.xy,size);
 return ReflectionRay(S0,d,end);
}`,
  )
