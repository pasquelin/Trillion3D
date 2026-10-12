import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { hizDepthWgsl } from './pyramidTexture.ts'

/** The distance, in pixels, a ray is taken past a cell boundary: four units in the last place of a
 *  pixel coordinate on the largest image WebGPU guarantees (8192 pixels, whose float32 step is
 *  2⁻¹⁰), so that no rounding leaves it behind. */
const SCREEN_MARCH_NUDGE = 2 ** -8

/**
 * THE ENGINE'S ONE SCREEN MARCH (`screenMarch`): where a ray crosses the depth the image drew, by a
 * hierarchical traversal of the depth pyramid (`hizDepthWgsl`, bound at `group`, `binding`). The
 * reflection's screen answer and the virtual shadow maps' contact ray are both this march, each
 * with its own reach and its own thickness; nothing else walks the depth.
 *
 * The ray is `o + d·t`, `o` in pixels and reversed depth, `t` from 0 to `end` (`screenMarchEnd`:
 * the image's edge, or the ray's far end). A surface is a slab: at level 0 the pixel's plane —
 * depth at its centre, slopes — and the plane `thickness` pixels of footprint behind it
 * (`screenBack`); a coarser cell's surfaces lie between its farthest depth of the finished image
 * (its planes to their far corner) and its nearest, and so do their slabs: between the farthest's
 * back and the nearest. It returns the `t` it stopped at, the plane (depth at its centre, slopes)
 * and centre of the pixel it stopped in (`ScreenHit`); `t` −1 where it meets nothing. `front` says
 * the hit is a transparent surface before the opaque depth: false until the pyramid holds one.
 *
 * A cell is crossed by the ray over `[t, across]`, whose depths lie between two bounds. Entirely in
 * front of the cell's nearest depth, or entirely behind the back of its farthest slab (which lies
 * behind every other slab of the cell), the ray meets nothing in it: the cell is consumed, and the
 * march goes one level up. Else it goes one level down. At level 0 the ray meets the slab where it
 * enters it: from its front, where the ray crosses the plane inside the pixel, or through the
 * pixel's side, where it is already within the slab at the pixel's edge. A ray behind the slab
 * consumes the pixel and goes on: it passes behind a thin surface, never in front of the surface
 * it stood on (the first pixel boundary opens the march).
 *
 * The iterations are bounded by the screen distance the ray covers, not by the pyramid
 * (`screenMarchBudget`): each cell of a level is crossed once, two levels' worth of ascents and
 * descents around each pixel the ray crosses, and the levels once more; a ray that leaves its
 * surface climbs the levels, and takes O(log reach) of them. A pixel a ray crosses is never
 * stepped over, whatever its width: the cells are exact bounds, never samples.
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
export const SCREEN_MARCH_WGSL = (group: number, binding: number) =>
  wgslBlock(
    `SCREEN_MARCH_WGSL(${group}, ${binding})`,
    [hizDepthWgsl(group, binding)],
    `const SCREEN_MARCH_NUDGE:f32=${wgslF32(SCREEN_MARCH_NUDGE)};
struct ScreenHit{t:f32,plane:vec3f,pixel:vec2f,front:bool,}
fn screenBack(z:f32,pixels:f32,slab:vec4f)->f32{
 let k=pixels*slab.x;
 let perspective=z-(z-slab.y)*k/(1.0+k);
 return select(z-pixels*slab.z,perspective,slab.w>0.5);
}
fn screenMarchEnd(o:vec2f,d:vec2f,size:vec2f)->f32{
 let toward=select(-o,size-o,d>vec2f(0.0));
 let t=select(vec2f(1.0),toward/d,abs(d)>vec2f(1e-6));
 return min(min(t.x,t.y),1.0);
}
fn screenMarchBudget(d:vec3f,end:f32,levels:i32)->u32{
 return u32(ceil(4.0*(abs(d.x)+abs(d.y))*end))+6u*u32(levels)+1u;
}
fn screenMarch(o:vec3f,d:vec3f,end:f32,thickness:f32,slab:vec4f)->ScreenHit{
 let tiny=vec2f(1e-6);
 let ahead=d.xy>=vec2f(0.0);
 let inv=1.0/select(d.xy,select(-tiny,tiny,ahead),abs(d.xy)<tiny);
 let side=select(vec2f(0.0),vec2f(1.0),ahead);
 let nudge=select(vec2f(-SCREEN_MARCH_NUDGE),vec2f(SCREEN_MARCH_NUDGE),ahead);
 let levels=hizLevelCount();
 let top=levels-1;
 let first=(floor(o.xy)+side+nudge-o.xy)*inv;
 let steps=screenMarchBudget(d,end,levels);
 var t=min(first.x,first.y);
 var level=0;
 for(var k=0u;k<steps;k++){
  if(t>=end){break;}
  let size=exp2(f32(level));
  let p=o.xy+d.xy*t;
  let cell=floor(p/size);
  let exits=((cell+side)*size+nudge-o.xy)*inv;
  let across=min(min(exits.x,exits.y),end);
  let z0=o.z+d.z*t;
  let z1=o.z+d.z*across;
  if(level==0){
   let plane=hizPlane(vec2i(cell));
   let centre=cell+vec2f(0.5);
   let s0=plane.x+dot(p-centre,plane.yz);
   let s1=plane.x+dot(o.xy+d.xy*across-centre,plane.yz);
   let h0=z0-s0;
   let h1=z1-s1;
   if(h0>=0.0){
    if(h1<0.0){return ScreenHit(mix(t,across,h0/(h0-h1)),plane,centre,false);}
   }else if(s0>0.0){
    let back=screenBack(s0,thickness,slab);
    if(z0>=back){return ScreenHit(t,plane,centre,false);}
   }
   t=across;
   level=min(1,top);
   continue;
  }
  // The nearest first: a ray in front of every surface of the cell never reads its farthest.
  if(min(z0,z1)>hizCellNearest(vec2i(cell),level)||max(z0,z1)<screenBack(hizCellFarthest(vec2i(cell),level),thickness,slab)){
   t=across;
   level=min(level+1,top);
   continue;
  }
  level-=1;
 }
 return ScreenHit(-1.0,vec3f(0.0),vec2f(0.0),false);
}`,
  )
