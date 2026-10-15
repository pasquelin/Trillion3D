import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { slabPerspective } from '../../../../math/src/wgsl/projection.ts'
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
 * and centre of the pixel it stopped in (`ScreenHit`), and the iterations it took (`steps`, its budget
 * where it meets nothing); `t` −1 where it meets nothing. `front` says
 * the hit is a transparent surface before the opaque depth: `hizFrontOver`, false where the pyramid holds none: the reflection keeps
 * it, the contact shadow skips it.
 *
 * A cell is crossed by the ray over `[t, across]`, whose depths lie between two bounds. Entirely in
 * front of the cell's nearest depth, or entirely behind the back of its farthest slab (which lies
 * behind every other slab of the cell), the ray meets nothing in it: the cell is consumed, and the
 * march goes one level up. Else the ray first moves to where it reaches the cell's nearest depth —
 * before that point it is in front of every surface the cell holds, so nothing can be met there, and
 * a descent always gains ground — and goes one level down. At level 0 the ray meets the slab where it
 * enters it: from its front, where the ray crosses the plane inside the pixel, or through the
 * pixel's side, where it is already within the slab at the pixel's edge. A ray behind the slab
 * consumes the pixel and goes on: it passes behind a thin surface, never in front of the surface
 * it stood on (the first pixel boundary opens the march).
 *
 * A FLOOR LEVEL: over the budget's last levels' worth of iterations, the march descends no lower than
 * one more level each, so that every ray crosses the screen within its budget and none is cut short.
 * A cell of the floor that the ray does not consume is met where the ray lies within the slab of the
 * pixel under it (at or behind its surface, in front of its back: level 0's slab, so a thin surface
 * stays thin), at the point the ray crossed that pixel's plane — a hit as sharp as level 0's —, and
 * crossed elsewhere: what the cell holds beside that pixel is within the budget's reach. Every ray is
 * exact until then: a cone's width is no reason to step over a cell, whose surfaces beside the pixel
 * under the ray a coarse cell would cross unmet — a lobe's rays, each its own direction, then meeting
 * a wall or missing it at random.
 *
 * The iterations are bounded by the screen distance the ray covers, not by the pyramid
 * (`screenMarchBudget`): each cell of a level is crossed once, two levels' worth of ascents and
 * descents around each pixel the ray crosses, and the levels once more; a ray in front of the
 * surfaces climbs a level an iteration, so `n` iterations cover up to 2ⁿ pixels of empty screen, and
 * a ray that leaves its surface takes O(log reach) of them. A pixel a ray crosses is never stepped
 * over below the floor level: the cells are exact bounds, never samples. A caller holds the march to
 * fewer iterations (`cap`): the floor rises over the last of them, so the ray's precision falls
 * gradually where the budget runs short, never its answer at once.
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
    [hizDepthWgsl(group, binding), slabPerspective],
    `const SCREEN_MARCH_NUDGE:f32=${wgslF32(SCREEN_MARCH_NUDGE)};
struct ScreenHit{t:f32,plane:vec3f,pixel:vec2f,front:bool,steps:u32,}
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
}
fn screenMarch(o:vec3f,d:vec3f,end:f32,thickness:f32,slab:vec4f,cap:u32)->ScreenHit{
 let tiny=vec2f(1e-6);
 let ahead=d.xy>=vec2f(0.0);
 let inv=1.0/select(d.xy,select(-tiny,tiny,ahead),abs(d.xy)<tiny);
 let side=select(vec2f(0.0),vec2f(1.0),ahead);
 let nudge=select(vec2f(-SCREEN_MARCH_NUDGE),vec2f(SCREEN_MARCH_NUDGE),ahead);
 let levels=hizLevelCount();
 let top=levels-1;
 let first=(floor(o.xy)+side+nudge-o.xy)*inv;
 let steps=min(screenMarchBudget(d,end,levels),cap);
 var t=min(first.x,first.y);
 var level=0;
 for(var k=0u;k<steps;k++){
  if(t>=end){break;}
  let start=t;
  // The widest level a cell may be met at: none but the pixel's, until the budget's last levels' worth
  // of iterations, one more each, so that a ray always crosses the screen.
  let floorLevel=min(max(0,i32(k)+top+1-i32(steps)),top);
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
    if(h1<0.0){return ScreenHit(mix(t,across,h0/(h0-h1)),plane,centre,hizFrontOver(vec2i(cell)),k);}
   }else if(s0>0.0){
    let back=screenBack(s0,thickness,slab);
    if(z0>=back){return ScreenHit(t,plane,centre,hizFrontOver(vec2i(cell)),k);}
   }
   t=across;
   level=min(1,top);
   continue;
  }
  // The nearest first: a ray in front of every surface of the cell never reads its farthest.
  let nearest=hizCellNearest(vec2i(cell),level);
  if(min(z0,z1)>nearest){
   t=across;
   level=min(level+1,top);
   continue;
  }
  // In front of every surface of the cell until it reaches the nearest depth: it moves there.
  let entry=select(t,mix(t,across,(z0-nearest)/(z0-z1)),z0>nearest);
  let z=o.z+d.z*entry;
  if(max(z,z1)<screenBack(hizCellFarthest(vec2i(cell),level),thickness,slab)){
   t=across;
   level=min(level+1,top);
   continue;
  }
  t=entry;
  // A cell no finer than the floor is met where the ray lies inside the slab of the pixel under it — at
  // or behind its surface, not past its back, level 0's slab, so a thin surface stays thin —, and
  // crossed elsewhere: what it holds beside that pixel is within the budget's reach.
  if(level<=floorLevel){
   let under=floor(o.xy+d.xy*t);
   let plane=hizPlane(vec2i(under));
   let s=plane.x+dot(o.xy+d.xy*t-under-vec2f(0.5),plane.yz);
   if(s>0.0&&z<=s&&z>=screenBack(s,thickness,slab)){
    // Where the ray crossed that plane, within the cell: the hit as sharp as level 0's.
    let dh=d.z-dot(d.xy,plane.yz);
    let at=select(t,max(start,t-(z-s)/dh),dh<0.0);
    return ScreenHit(at,plane,under+vec2f(0.5),hizFrontOver(vec2i(under)),k);
   }
   t=across;
   level=min(level+1,top);
   continue;
  }
  level-=1;
 }
 return ScreenHit(-1.0,vec3f(0.0),vec2f(0.0),false,steps);
}`,
  )
