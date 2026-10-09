import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constants.ts'

/**
 * The hierarchical ray march (`reflectionMarch`) of the depth pyramid, `o + d·t`, `o` in pixels and reversed depth, `t` from 0
 * to `end` (`reflectionScreenEnd`: the image's edge, or the ray's far end). A cell's surface is the
 * pixel's plane at level 0 — the ray's height above it falls at d.z − slopes · d.xy along `t` —, the
 * cell's nearest depth above it. It returns the `t` it stopped at, and the plane (depth at its
 * centre, slopes) and centre of the pixel it stopped in (`ReflectionHit`); `t` −1 on a miss.
 *
 * A ray in front of a cell's surface moves to the surface where it meets it, else to the cell's
 * boundary and one level coarser; one behind a cell's nearest depth stays and goes one level finer.
 * At level 0 the ray is behind the pixel's plane, and stops there if it was in front of it one step
 * — one pixel of its path — earlier, after the last place it was in front of everything it passed:
 * it crossed that plane, and hits the surface. Behind it without a crossing, the ray passes behind
 * a surface it never met: a miss. `last` begins at the first pixel boundary, so a hit is never in
 * the pixel the ray leaves. A ray misses too when it leaves the image or reaches its far end
 * (`reflectionReach`), and when its iterations — `REFLECTION_ITERATIONS_PER_LEVEL` a level of the
 * pyramid — run out: the plain miss of a ray that skims a surface.
 */
export const REFLECTION_MARCH_WGSL = wgslBlock(
  'REFLECTION_MARCH_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `struct ReflectionHit{t:f32,plane:vec3f,pixel:vec2f,}
fn reflectionScreenEnd(o:vec2f,d:vec2f,size:vec2f)->f32{
 let toward=select(-o,size-o,d>vec2f(0.0));
 let t=select(vec2f(1.0),toward/d,abs(d)>vec2f(1e-6));
 return min(min(t.x,t.y),1.0);
}
fn reflectionMarch(o:vec3f,d:vec3f,end:f32)->ReflectionHit{
 let tiny=vec2f(1e-6);
 let ahead=d.xy>=vec2f(0.0);
 let inv=1.0/select(d.xy,select(-tiny,tiny,ahead),abs(d.xy)<tiny);
 let side=select(vec2f(0.0),vec2f(1.0),ahead);
 let nudge=select(vec2f(-REFLECTION_NUDGE),vec2f(REFLECTION_NUDGE),ahead);
 let step=1.0/max(max(abs(d.x),abs(d.y)),1e-6);
 let levels=hizLevelCount();
 let top=levels-1;
 let first=(floor(o.xy)+side+nudge-o.xy)*inv;
 var t=min(first.x,first.y);
 var last=t;
 var level=0;
 for(var k=0u;k<REFLECTION_ITERATIONS_PER_LEVEL*u32(levels);k++){
  if(t>end){break;}
  let p=o+d*t;
  let size=exp2(f32(level));
  let cell=floor(p.xy/size);
  let exits=((cell+side)*size+nudge-o.xy)*inv;
  let across=min(exits.x,exits.y);
  var plane=vec3f(0.0);
  var height=0.0;
  var rate=d.z;
  if(level==0){
   plane=hizPlane(vec2i(cell));
   height=p.z-plane.x-dot(p.xy-cell-vec2f(0.5),plane.yz);
   rate=d.z-dot(d.xy,plane.yz);
  }else{height=p.z-hizCell(vec2i(cell),level).y;}
  if(height>=0.0){
   last=t;
   let reach=t-height/min(rate,-1e-30);
   if(rate>=0.0||across<reach){t=across;level=min(level+1,top);continue;}
   t=reach;
  }else if(level==0){
   let crossed=t-height/min(rate,-1e-30);
   if(rate>=0.0||crossed<max(last,t-step)){break;}
   t=crossed;
  }
  if(level==0){
   if(t>end){break;}
   return ReflectionHit(t,plane,cell+vec2f(0.5));
  }
  level-=1;
 }
 return ReflectionHit(-1.0,vec3f(0.0),vec2f(0.0));
}`,
)
