import { REFLECTION_SEGMENT } from './traceShader.ts';

/** Steps a rough ray takes at most; past them it misses and its lobe reads the fallback, as a ray
 *  leaving the screen does. The reference's hierarchical trace holds a fixed count the same way. */
const REFLECTION_TRACE_STEPS = 64;

/** Which pixel of its 2 × 2 block a half-resolution trace texel serves at `seed`: the four in
 *  turn, so four frames reach every pixel. The trace and the history resolve read the same one. */
export const REFLECTION_PHASE_WGSL = `
fn reflectionPhase(seed:u32)->vec2i{return vec2i(i32(((seed+1u)>>1u)&1u),i32(seed&1u));}`;

/**
 * The hierarchical walk of a projected segment (`start` + `delta`·t, depth `za` to `zb`) over the
 * nearest/farthest depth pyramid the cone reads (`reflectionBoundsAt`, level 0 the depth itself):
 * a cell whose depth range the segment's cannot cross is skipped whole and the walk climbs a level;
 * one it may cross is entered a level down; at level 0 the crossing is the pixel's own test, the
 * one the full-resolution walk makes (`traceShader.ts`). The receiver's pixel never answers.
 * Written per axis, so the Node test runs this very text.
 */
const HIZ_WALK_WGSL = `
fn reflectionHiZWalk(start:vec2f,delta:vec2f,za:f32,zb:f32,size:vec2f)->vec4f{
 let top=i32(textureNumLevels(reflectionBounds));let ox=i32(floor(start.x));let oy=i32(floor(start.y));
 var level=0;var t=0.0;
 for(var i=0;i<${REFLECTION_TRACE_STEPS};i++){
  let x=start.x+delta.x*t+sign(delta.x)*0.001;let y=start.y+delta.y*t+sign(delta.y)*0.001;
  if(x<0.0||y<0.0||x>=size.x||y>=size.y){break;}
  let side=exp2(f32(level));let cx=floor(x/side);let cy=floor(y/side);
  var bx=1e30;var by=1e30;
  if(delta.x>0.0){bx=((cx+1.0)*side-start.x)/delta.x;}
  if(delta.x<0.0){bx=(cx*side-start.x)/delta.x;}
  if(delta.y>0.0){by=((cy+1.0)*side-start.y)/delta.y;}
  if(delta.y<0.0){by=(cy*side-start.y)/delta.y;}
  let exited=min(1.0,min(bx,by));let z0=mix(za,zb,t);let z1=mix(za,zb,exited);
  let cell=vec2i(i32(cx),i32(cy));let range=reflectionBoundsAt(cell,level);
  if(!(level==0&&cell.x==ox&&cell.y==oy)&&range.x<=range.y&&range.x<=max(z0,z1)&&range.y>=min(z0,z1)){
   if(level==0){return reflectionHitAt(cell);}
   level-=1;
   continue;
  }
  if(exited>=1.0){break;}
  t=exited;
  level=min(level+1,top);
 }
 return vec4f(0.0);
}`;

/** The rough trace's ray: clipped as the full walk's (`reflectionExit`), then walked over the
 *  pyramid within `REFLECTION_TRACE_STEPS`. A hit reads the reprojected source, whose alpha tells
 *  a pixel the last image did not see: a miss. */
export const HIZ_TRACE_WGSL = `${HIZ_WALK_WGSL}
fn screenReflectionHiZ(P:vec3f,R:vec3f)->vec4f{${REFLECTION_SEGMENT} return reflectionHiZWalk(start,delta,a.z,b.z,size);
}`;
