import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/** The span of a ray inside a box, clamped to [tMin, tMax]: its two ends. */
export const HV_INTERSECT_AABB = wgslFn(
  'hvIntersectAabb',
  [],
  `fn hvIntersectAabb(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,boxMin:vec3f,boxMax:vec3f)->vec2f{
 let inverse=1.0/direction;
 let first=(boxMin-origin)*inverse;
 let second=(boxMax-origin)*inverse;
 let near=min(first,second);
 let far=max(first,second);
 return vec2f(max(max(near.x,max(near.y,near.z)),tMin),min(min(far.x,min(far.y,far.z)),tMax));
}`,
)
