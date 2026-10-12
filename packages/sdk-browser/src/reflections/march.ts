import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constants.ts'
import { reflectionGeometryWgsl } from './geometry.ts'

/**
 * The hierarchical ray march (`reflectionMarch`) of the depth pyramid, `o + d·t`, `o` in pixels and
 * reversed depth, `t` from 0 to `end` (`reflectionRay`: the image's edge, or the ray's far end,
 * within `REFLECTION_STEP_CAP` pixels of the ray's origin). A surface is a slab: at level 0 the
 * pixel's plane — depth at its centre, slopes — and the plane `REFLECTION_THICKNESS` pixels of
 * footprint behind it (`reflectionBack`); a coarser cell's surfaces lie between its farthest depth
 * of the finished image and its nearest, and so do their slabs: between the farthest's back and the
 * nearest. It returns the `t` it stopped at, the plane (depth at its centre, slopes) and centre of
 * the pixel it stopped in (`ReflectionHit`); `t` −1 where it meets nothing.
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
 * (`reflectionBudget`): each cell of a level is crossed once, two levels' worth of ascents and
 * descents around each pixel the ray crosses, and the levels once more.
 */
export const REFLECTION_MARCH_WGSL = (group: number) =>
  wgslBlock(
    `REFLECTION_MARCH_WGSL(${group})`,
    [REFLECTION_CONSTANTS_WGSL, reflectionGeometryWgsl(group)],
    `struct ReflectionHit{t:f32,plane:vec3f,pixel:vec2f,}
fn reflectionBudget(d:vec3f,end:f32,levels:i32)->u32{
 return u32(ceil(4.0*(abs(d.x)+abs(d.y))*end))+6u*u32(levels)+1u;
}
fn reflectionMarch(o:vec3f,d:vec3f,end:f32)->ReflectionHit{
 let tiny=vec2f(1e-6);
 let ahead=d.xy>=vec2f(0.0);
 let inv=1.0/select(d.xy,select(-tiny,tiny,ahead),abs(d.xy)<tiny);
 let side=select(vec2f(0.0),vec2f(1.0),ahead);
 let nudge=select(vec2f(-REFLECTION_NUDGE),vec2f(REFLECTION_NUDGE),ahead);
 let levels=hizLevelCount();
 let top=levels-1;
 let first=(floor(o.xy)+side+nudge-o.xy)*inv;
 let steps=reflectionBudget(d,end,levels);
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
    if(h1<0.0){return ReflectionHit(mix(t,across,h0/(h0-h1)),plane,centre);}
   }else if(s0>0.0){
    let back=reflectionBack(s0,REFLECTION_THICKNESS);
    if(z0>=back){return ReflectionHit(t,plane,centre);}
   }
   t=across;
   level=min(1,top);
   continue;
  }
  let bounds=hizCell(vec2i(cell),level);
  if(min(z0,z1)>bounds.y||max(z0,z1)<reflectionBack(bounds.x,REFLECTION_THICKNESS)){
   t=across;
   level=min(level+1,top);
   continue;
  }
  level-=1;
 }
 return ReflectionHit(-1.0,vec3f(0.0),vec2f(0.0));
}`,
  )
