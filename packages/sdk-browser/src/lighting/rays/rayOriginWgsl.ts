import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'

/**
 * THE START OF A RAY LEAVING A SURFACE (`rayOrigin`, metres): from the surface point P of normal N, toward the eye by the larger of a ten-thousandth of the distance to it and the normal bias
 * `bias` (the ray starts nearer the eye than the surface, which hides the surface's own depth error), then off the surface along N: by the larger of `least` and the bias for a ray
 * grazing the surface, by `least` for one facing the normal (`D`, the ray's direction, against N). The one start the ray-traced shadows and occlusion share.
 */
export const RAY_ORIGIN_WGSL = wgslFn(
  'rayOrigin',
  [WORLD_AT_WGSL],
  `fn rayOrigin(P:vec3f,N:vec3f,D:vec3f,normalBias:f32,least:f32)->vec3f{
 let bias=max(viewEyeDistance(P)*1.0e-4,normalBias);
 let toEye=P+viewToEye(P)*bias;
 return toEye+N*mix(max(least,bias),least,saturate(dot(N,D)));
}`,
)
