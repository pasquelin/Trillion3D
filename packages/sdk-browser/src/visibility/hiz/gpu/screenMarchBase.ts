import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { slabPerspective } from '../../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from './pyramidTexture.ts'

/**
 * WHAT THE SCREEN MARCHES SHARE (`screenMarch`): the hit they return (`ScreenHit`), the end and the
 * budget of a ray, and the geometry of a surface's thickness, over the depth pyramid
 * (`hizDepthWgsl`, bound at `group`, `binding`).
 *
 * `slab` is the geometry of a surface's thickness (`screenSlab`): the world size of a pixel at a
 * unit clip `w` (`x`), the depth at an infinite distance (`y`), the depth a pixel's thickness spans
 * under an orthographic projection (`z`), and whether the projection is a perspective (`w`).
 * `screenBack` is the depth of the point `pixels` pixels of footprint behind a surface at depth
 * `z`, along the eye's ray: affine in `z` and increasing with it, so that the back of the farthest
 * surface of a cell bounds the back of every surface of it. Under a perspective the thickness is
 * `k · w` of the surface's distance `w`, `k = pixels · scale`, and the depth `A + B / w`: its back
 * `A + B / (w · (1 + k)) = z − (z − A) · k / (1 + k)`, finite whatever `z`, never a point
 * projected. Under an orthographic projection the thickness is the same at every depth, and so is
 * the depth it spans. The surface's front is its mirror, `2 · z − back`.
 */
export const SCREEN_MARCH_BASE_WGSL = (group: number, binding: number) =>
  wgslBlock(
    `SCREEN_MARCH_BASE_WGSL(${group}, ${binding})`,
    [hizDepthWgsl(group, binding), slabPerspective],
    `struct ScreenHit{t:f32,plane:vec3f,pixel:vec2f,front:bool,steps:u32,}
fn screenBack(z:f32,pixels:f32,slab:vec4f)->f32{
 let k=pixels*slab.x;
 let perspective=z-(z-slab.y)*k/(1.0+k);
 return select(z-pixels*slab.z,perspective,slabPerspective(slab));
}
fn screenMarchEnd(o:vec2f,d:vec2f,size:vec2f)->f32{
 let toward=select(-o,size-o,d>vec2f(0.0));
 let t=select(vec2f(1.0),toward/d,abs(d)>vec2f(1e-6));
 return min(min(t.x,t.y),1.0);
}
fn screenMarchBudget(d:vec3f,end:f32,levels:i32)->u32{
 return u32(ceil(4.0*(abs(d.x)+abs(d.y))*end))+6u*u32(levels)+1u;
}`,
  )
