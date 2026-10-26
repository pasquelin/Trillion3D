import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../../math/src/wgsl/projection.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_DEPTH_BINDING, reflectionBindingsWgsl } from './viewLayout.ts'
import { SCREEN_MARCH_WGSL } from '../../visibility/hiz/gpu/screenMarch.ts'

/**
 * The screen ray of a reflection (`reflectionRaySpan`: the part of it between the distances `start` and `stop`
 * along the ray, the far trace's too): its origin, its direction to the far end of its reach, how far along it the
 * march goes (`end`: the image's edge, `screenMarchEnd`: the march's hierarchy crosses empty screen in a few
 * iterations, and `reflectionScreenSteps` bounds it, `ReflectionView.scene`), and what turns the march's
 * screen parameter into a distance along the ray (`reflectionRayDistance`): the clip `w` of its two ends, where it
 * starts and how long it is. It leaves the surface off along its normal by `reflectionRayBias`, twice the distance
 * from the pixel's point to its far corner measured along the normal: a ray never starts inside the depth it leaves.
 * `reflectionReach`: the world distance along a reflected ray, from its origin `A` (clip) along
 * `toward` (clip), to which the screen can answer: where it meets the near plane, or `REFLECTION_FAR`.
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
    `fn reflectionReach(A:vec4f,toward:vec4f)->f32{
 let grow=toward.z-toward.w;
 return select(REFLECTION_FAR,(A.w-A.z)/grow,grow>0.0);
}
fn reflectionRayBias(P:vec3f,N:vec3f)->f32{
 let S=clipToFramebuffer(reflectionView.viewProj*vec4f(P,1.0),view.viewport.xy);
 return 2.0*abs(dot(worldAt(S.xy+vec2f(0.5),S.z)-P,N));
}
struct ReflectionRay{o:vec3f,d:vec3f,end:f32,wb:f32,we:f32,start:f32,span:f32,}
fn reflectionRaySpan(P:vec3f,N:vec3f,lobe:ReflectionLobe,bias:f32,start:f32,stop:f32)->ReflectionRay{
 let size=view.viewport.xy;
 let origin=P+N*bias;
 let A=reflectionView.viewProj*vec4f(origin,1.0);
 let toward=reflectionView.viewProj*vec4f(lobe.R,0.0);
 let reach=min(reflectionReach(A,toward),stop);
 let B=A+toward*start;
 let E=A+toward*reach;
 let S0=clipToFramebuffer(B,size);
 let d=clipToFramebuffer(E,size)-S0;
 let end=screenMarchEnd(S0.xy,d.xy,size);
 // A span that starts past the surface marches only where it lies in front of the camera and on the image.
 let on=start<=0.0||(reach>start&&B.w>0.0&&all(S0.xy>=vec2f(0.0))&&all(S0.xy<size));
 return ReflectionRay(S0,d,select(0.0,end,on),B.w,E.w,start,max(reach-start,0.0));
}
fn reflectionRayDistance(ray:ReflectionRay,t:f32)->f32{
 return ray.start+ray.span*t*ray.wb/max((1.0-t)*ray.we+t*ray.wb,REFLECTION_FLOOR);
}`,
  )
