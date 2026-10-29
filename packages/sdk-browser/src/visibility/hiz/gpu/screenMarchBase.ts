import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { slabPerspective } from '../../../../../math/src/wgsl/projection.ts'
import { CENTIMETRES_PER_METRE } from '../../../../../sdk-core/src/page/format.ts'
import { hizDepthWgsl } from './pyramidTexture.ts'

/** The floor of the surface depth a relative thickness is a share of (`screenRelativeBack`), in
 *  centimetres, as the walk's reference counts: the world's unit is the metre. */
const DEPTH_FLOOR_CENTIMETRES = 1e-5

/** The share of the step `d` from 'o' that stays within the rectangle of 'size', one at the most: where a march ends at the border of the image (a pure function of its arguments). */
export const SCREEN_MARCH_END_WGSL = wgslBlock(
  'SCREEN_MARCH_END_WGSL',
  [],
  `fn screenMarchEnd(o:vec2f,d:vec2f,size:vec2f)->f32{
 let toward=select(-o,size-o,d>vec2f(0.0));
 let t=select(vec2f(1.0),toward/d,abs(d)>vec2f(1e-6));
 return min(min(t.x,t.y),1.0);
}`,
)

/**
 * WHAT THE SCREEN MARCHES SHARE (`screenMarch`): the hit they return (`ScreenHit`), the end of a
 * ray, and the geometry of a surface's thickness, over the depth pyramid
 * (`hizDepthWgsl`, bound at `group`, `binding`).
 *
 * `slab` is the geometry of a surface's thickness (`screenSlab`): the world size of a pixel at a
 * unit clip `w` (`x`), whether the projection is a perspective (`w`), and by the projection `y` and
 * `z`. Under a perspective the depth is `A + B / w` of the surface's distance `w` in metres: `y` is
 * `A`, the depth at an infinite distance, and `z` is `B`. Under an orthographic projection `y` is
 * the depth of the eye's plane (distance 0) and `z` the depth a pixel's thickness spans, the depth
 * falling `z / x` a metre.
 * `screenBack` is the depth of the point `pixels` pixels of footprint behind a surface at depth
 * `z`, along the eye's ray: affine in `z` and increasing with it, so that the back of the farthest
 * surface of a cell bounds the back of every surface of it. Under a perspective the thickness is
 * `k · w` of the surface's distance `w`, `k = pixels · scale`, and the depth `A + B / w`: its back
 * `A + B / (w · (1 + k)) = z − (z − A) · k / (1 + k)`, finite whatever `z`, never a point
 * projected. Under an orthographic projection the thickness is the same at every depth, and so is
 * the depth it spans. The surface's front is its mirror, `2 · z − back`. Both perspective forms are
 * `screenBackAt`.
 *
 * `screenRelativeBack` is the same point for a thickness `relative` that is a share of the surface's
 * own depth, not pixels (the reference walk's, `screenRelativeThickness`): the point `relative` of
 * the surface's distance behind it, `screenBackAt` with `k = r`, the distance floored at a hundred
 * thousandth of a centimetre (`DEPTH_FLOOR_CENTIMETRES`, in metres here): a ray lies in front of
 * that point when it is less far behind the surface than `r · max(distance, floor)`. Under an
 * orthographic projection the distance is measured from the eye's plane (`slab.y`).
 */
export const SCREEN_MARCH_BASE_WGSL = (group: number, binding: number) =>
  wgslBlock(
    `SCREEN_MARCH_BASE_WGSL(${group}, ${binding})`,
    [hizDepthWgsl(group, binding), slabPerspective, SCREEN_MARCH_END_WGSL],
    `const SCREEN_DEPTH_FLOOR:f32=${wgslF32(DEPTH_FLOOR_CENTIMETRES / CENTIMETRES_PER_METRE)};
struct ScreenHit{t:f32,plane:vec3f,pixel:vec2f,front:bool,steps:u32,above:f32,}
fn screenMarchMissed(steps:u32,above:f32)->ScreenHit{
 return ScreenHit(-1.0,vec3f(0.0),vec2f(0.0),false,steps,above);
}
fn screenBackAt(z:f32,infinite:f32,k:f32)->f32{return z-(z-infinite)*k/(1.0+k);}
fn screenBack(z:f32,pixels:f32,slab:vec4f)->f32{
 return select(z-pixels*slab.z,screenBackAt(z,slab.y,pixels*slab.x),slabPerspective(slab));
}
fn screenRelativeBack(z:f32,relative:f32,slab:vec4f)->f32{
 let distanceShare=max(1.0,SCREEN_DEPTH_FLOOR*(z-slab.y)/slab.z);
 let perspective=screenBackAt(z,slab.y,relative*distanceShare);
 let orthographic=z-relative*max(slab.y-z,slab.z/slab.x*SCREEN_DEPTH_FLOOR);
 return select(orthographic,perspective,slabPerspective(slab));
}
`,
  )
