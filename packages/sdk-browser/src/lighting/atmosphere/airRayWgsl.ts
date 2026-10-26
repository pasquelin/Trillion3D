import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { unprojectPoint } from '../../../../math/src/wgsl/projection.ts'

/**
 * WHERE THE RAY OF A PIXEL STARTS ON THE PLANET, and along which direction: the one place the air's
 * programs — the sky, the haze volume, the haze marched on the opaque surfaces and on the clouds —
 * take a pixel's ray from, so that a perspective view and an orthographic one are the same
 * programs.
 *
 * A perspective view's rays leave the eye (`frame.camera`, the eye held over the ground), each
 * through its pixel. An orthographic view's (`frame.eye.w` 0) leave the pixel's own point on the near
 * plane and run along the view's direction, the same for every pixel; so the air they cross, the
 * height they start from, differs from a pixel to the next. That point is raised by half the
 * view's height, so that a pixel at the bottom of the view starts from the height of the eye's
 * and not from under it — a view that stands on the ground has no pixel in the planet. The
 * raise is made on the planet's up, the scene's `y`, and is the frame's (`frame.lift`, worked out
 * once an image on the CPU, `orthographicLift`), not each pixel's. The unit is the scene's metres
 * for the point and the planet's kilometres for its place.
 *
 * - `airStart(ndc)`: where the ray of the pixel of the normalised device coordinates `ndc` leaves the
 *   scene, metres: the eye, or an orthographic view's point of the pixel on the near plane;
 * - `airRayOf(scene, dir)`: the ray that leaves the scene point `scene` along the unit `dir`;
 * - `airRay(ndc)`: the ray of the pixel `ndc`;
 * - `AirRay.scene`: where it leaves, scene metres; `origin`: the same on the planet, kilometres from
 *   its centre; `height`: its distance from the centre; `dir`: the unit direction.
 */
export const AIR_RAY_WGSL = wgslBlock(
  'AIR_RAY_WGSL',
  [unprojectPoint],
  `
struct AirRay{scene:vec3f,origin:vec3f,dir:vec3f,height:f32,}
fn airUnproject(ndc:vec2f,z:f32)->vec3f{return unprojectPoint(frame.inverseViewProj,vec3f(ndc,z));}
fn airRayOf(scene:vec3f,dir:vec3f)->AirRay{
 var ray:AirRay;
 ray.scene=scene;
 ray.dir=dir;
 ray.origin=frame.camera.xyz;
 ray.height=frame.camera.w;
 if(frame.eye.w==0.0){
  ray.origin+=(scene+frame.lift.xyz-frame.eye.xyz)*0.001;
  ray.height=length(ray.origin);
 }
 return ray;
}
fn airStart(ndc:vec2f)->vec3f{
 if(frame.eye.w==0.0){return airUnproject(ndc,1.0);}
 return frame.eye.xyz;
}
fn airRay(ndc:vec2f)->AirRay{
 let begin=airStart(ndc);
 return airRayOf(begin,normalize(airUnproject(ndc,0.5)-begin));
}`,
)
