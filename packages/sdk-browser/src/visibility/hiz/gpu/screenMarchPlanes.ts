import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { SCREEN_MARCH_BASE_WGSL } from './screenMarchBase.ts'

/** The distance, in pixels, a ray is taken past a cell boundary: four units in the last place of a
 *  pixel coordinate on the largest image WebGPU guarantees (8192 pixels, whose float32 step is
 *  2⁻¹⁰), so that no rounding leaves it behind. */
const SCREEN_MARCH_NUDGE = 2 ** -8

/**
 * THE ENGINE'S OWN SCREEN MARCH (`screenMarchPlanes`, the `'planes'` setting of `hizTrace`): where a ray crosses the depth the image drew, by a
 * hierarchical traversal of the depth pyramid (`hizDepthWgsl`, bound at `group`, `binding`): the
 * reflection's screen answer, with its reach and its thickness. The virtual shadow maps' contact
 * ray is not a march: four samples of level 0 (`vsmScreenRayFrom`), a contact ray being short.
 *
 * The ray is `o + d·t`, `o` in pixels and reversed depth, `t` from 0 to `end` (`screenMarchEnd`:
 * the image's edge, or the ray's far end). A surface is a slab: at level 0 the pixel's plane —
 * depth at its centre, slopes — and the plane `thickness` pixels of footprint behind it
 * (`screenBack`); a coarser cell's surfaces lie between its farthest depth of the finished image
 * (its planes to their far corner) and its nearest, and so do their slabs: between the farthest's
 * back and the nearest. It returns the `t` it stopped at, the plane (depth at its centre, slopes)
 * and centre of the pixel it stopped in (`ScreenHit`), and the iterations it took (`steps`, the `cap` where
 * it meets nothing); `t` −1 where it meets nothing. `front` says
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
 * A FLOOR LEVEL: over the last levels' worth of the caller's iterations (`cap`), the march descends no lower than
 * one more level each, so that every ray crosses the screen within them and none is cut short.
 * A cell of the floor that the ray does not consume is met where the ray lies within the slab of the
 * pixel under it (at or behind its surface, in front of its back: level 0's slab, so a thin surface
 * stays thin), at the point the ray crossed that pixel's plane — a hit as sharp as level 0's —, and
 * crossed elsewhere: what the cell holds beside that pixel is within the iterations' reach. Every ray is
 * exact until then: a cone's width is no reason to step over a cell, whose surfaces beside the pixel
 * under the ray a coarse cell would cross unmet — a lobe's rays, each its own direction, then meeting
 * a wall or missing it at random.
 *
 * The iterations are bounded by the caller's one cap (`cap`, the reference's maximum of iterations, a setting): each cell of a level
 * is crossed once, two levels' worth of ascents and descents around each pixel the ray crosses, and the levels once more; a ray in front of the
 * surfaces climbs a level an iteration, so `n` iterations cover up to 2ⁿ pixels of empty screen, and
 * a ray that leaves its surface takes O(log reach) of them. A pixel a ray crosses is never stepped
 * over below the floor level: the cells are exact bounds, never samples. The floor rises over the last
 * of the cap's iterations, so the ray's precision falls gradually where they run short, never its answer at once.
 *
 * The nearest first: a ray in front of every surface of a cell never reads its farthest. A ray in
 * front of every surface of the cell until it reaches the nearest depth moves there. A cell no finer
 * than the floor level is met where the ray lies inside the slab of the pixel under it — at or
 * behind its surface, not past its back, level 0's slab, so a thin surface stays thin —, and crossed
 * elsewhere: what it holds beside that pixel is within the iterations' reach; the hit is where the ray
 * crossed that plane, within the cell: as sharp as level 0's.
 */
const SCREEN_MARCH_PIXELS_WGSL = (group: number, binding: number) =>
  wgslBlock(
    `SCREEN_MARCH_PIXELS_WGSL(${group}, ${binding})`,
    [SCREEN_MARCH_BASE_WGSL(group, binding)],
    `fn screenPlanesPixel(o:vec3f,d:vec3f,t:f32,across:f32,cell:vec2f,thickness:f32,slab:vec4f,k:u32)->ScreenHit{
 let miss=screenMarchMissed(0u,0.0);
 let plane=hizPlane(vec2i(cell));
 let centre=cell+vec2f(0.5);
 let s0=plane.x+dot(o.xy+d.xy*t-centre,plane.yz);
 let s1=plane.x+dot(o.xy+d.xy*across-centre,plane.yz);
 let h0=o.z+d.z*t-s0;
 let h1=o.z+d.z*across-s1;
 if(h0>=0.0){
  if(h1<0.0){return ScreenHit(mix(t,across,h0/(h0-h1)),plane,centre,hizFrontOver(vec2i(cell)),k,0.0);}
 }else if(s0>0.0){
  let back=screenBack(s0,thickness,slab);
  if(o.z+d.z*t>=back){return ScreenHit(t,plane,centre,hizFrontOver(vec2i(cell)),k,0.0);}
  return screenMarchMissed(0u,t);
 }
 return miss;
}
fn screenPlanesFloor(o:vec3f,d:vec3f,t:f32,start:f32,thickness:f32,slab:vec4f,k:u32)->ScreenHit{
 let z=o.z+d.z*t;
 let under=floor(o.xy+d.xy*t);
 let plane=hizPlane(vec2i(under));
 let s=plane.x+dot(o.xy+d.xy*t-under-vec2f(0.5),plane.yz);
 if(s>0.0&&z<=s&&z>=screenBack(s,thickness,slab)){
  let dh=d.z-dot(d.xy,plane.yz);
  let at=select(t,max(start,t-(z-s)/dh),dh<0.0);
  return ScreenHit(at,plane,under+vec2f(0.5),hizFrontOver(vec2i(under)),k,0.0);
 }
 return screenMarchMissed(0u,0.0);
}`,
  )

export const SCREEN_MARCH_PLANES_WGSL = (group: number, binding: number) =>
  wgslBlock(
    `SCREEN_MARCH_PLANES_WGSL(${group}, ${binding})`,
    [SCREEN_MARCH_PIXELS_WGSL(group, binding)],
    `const SCREEN_MARCH_NUDGE:f32=${wgslF32(SCREEN_MARCH_NUDGE)};
fn screenMarchPlanes(o:vec3f,d:vec3f,end:f32,thickness:f32,slab:vec4f,cap:u32)->ScreenHit{
 var unproven=end;
 let tiny=vec2f(1e-6);
 let ahead=d.xy>=vec2f(0.0);
 let inv=1.0/select(d.xy,select(-tiny,tiny,ahead),abs(d.xy)<tiny);
 let side=select(vec2f(0.0),vec2f(1.0),ahead);
 let nudge=select(vec2f(-SCREEN_MARCH_NUDGE),vec2f(SCREEN_MARCH_NUDGE),ahead);
 let top=hizLevelCount()-1;
 let first=(floor(o.xy)+side+nudge-o.xy)*inv;
 let steps=cap;
 var t=min(first.x,first.y);
 var level=0;
 for(var k=0u;k<steps;k++){
  if(t>=end){break;}
  let start=t;
  let floorLevel=min(max(0,i32(k)+top+1-i32(steps)),top);
  let size=exp2(f32(level));
  let p=o.xy+d.xy*t;
  let cell=floor(p/size);
  let exits=((cell+side)*size+nudge-o.xy)*inv;
  let across=min(min(exits.x,exits.y),end);
  if(level==0){
   let met=screenPlanesPixel(o,d,t,across,cell,thickness,slab,k);
   if(met.t>=0.0){return met;}
   if(met.above>0.0){unproven=min(unproven,met.above);}
   t=across;
   level=min(1,top);
   continue;
  }
  let z0=o.z+d.z*t;
  let z1=o.z+d.z*across;
  let nearest=hizCellNearest(vec2i(cell),level);
  if(min(z0,z1)>nearest){
   t=across;
   level=min(level+1,top);
   continue;
  }
  let entry=select(t,mix(t,across,(z0-nearest)/(z0-z1)),z0>nearest);
  let z=o.z+d.z*entry;
  if(max(z,z1)<screenBack(hizCellFarthest(vec2i(cell),level),thickness,slab)){
   unproven=min(unproven,entry);
   t=across;
   level=min(level+1,top);
   continue;
  }
  t=entry;
  if(level<=floorLevel){
   let met=screenPlanesFloor(o,d,t,start,thickness,slab,k);
   if(met.t>=0.0){return met;}
   unproven=min(unproven,t);
   t=across;
   level=min(level+1,top);
   continue;
  }
  level-=1;
 }
 return screenMarchMissed(steps,min(min(t,end),unproven));
}`,
  )
