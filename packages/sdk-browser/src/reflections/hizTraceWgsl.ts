/** Steps a rough ray takes at most; past them it misses and its lobe reads the fallback, as a ray
 *  leaving the screen does. The reference's hierarchical trace holds a fixed count the same way. */
export const REFLECTION_TRACE_STEPS = 64;

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
export const HIZ_WALK_WGSL = `
fn reflectionHiZWalk(start:vec2f,delta:vec2f,za:f32,zb:f32,size:vec2f)->vec4f{
 var top:i32=reflectionTopLevel();
 var ox:i32=i32(floor(start.x));var oy:i32=i32(floor(start.y));
 var level:i32=0;var t:f32=0.0;
 for(var i:i32=0;i<${REFLECTION_TRACE_STEPS};i++){
  var x:f32=start.x+delta.x*t+sign(delta.x)*0.001;
  var y:f32=start.y+delta.y*t+sign(delta.y)*0.001;
  if(x<0.0||y<0.0||x>=size.x||y>=size.y){break;}
  var side:f32=exp2(f32(level));
  var cx:f32=floor(x/side);var cy:f32=floor(y/side);
  var bx:f32=1e30;var by:f32=1e30;
  if(delta.x>0.0){bx=((cx+1.0)*side-start.x)/delta.x;}
  if(delta.x<0.0){bx=(cx*side-start.x)/delta.x;}
  if(delta.y>0.0){by=((cy+1.0)*side-start.y)/delta.y;}
  if(delta.y<0.0){by=(cy*side-start.y)/delta.y;}
  var exited:f32=min(1.0,min(bx,by));
  var z0:f32=mix(za,zb,t);var z1:f32=mix(za,zb,exited);
  var range:vec2f=reflectionBoundsAt(vec2i(i32(cx),i32(cy)),level);
  var own:bool=level==0&&i32(cx)==ox&&i32(cy)==oy;
  if(!own&&range.x<=range.y&&range.x<=max(z0,z1)&&range.y>=min(z0,z1)){
   if(level==0){return reflectionHitAt(vec2i(i32(cx),i32(cy)));}
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
fn reflectionTopLevel()->i32{return i32(textureNumLevels(reflectionBounds));}
fn screenReflectionHiZ(P:vec3f,R:vec3f)->vec4f{
 let c=reflectionProject(vec4f(P,1.0));
 let d=reflectionProject(vec4f(R,0.0));
 let reach=reflectionExit(c,d);
 if(reach<=0.0||c.w<=0.0){return vec4f(0.0);}
 let e=c+d*reach;
 if(e.w<=0.0){return vec4f(0.0);}
 let size=reflectionSize();
 let a=c.xyz/c.w;let b=e.xyz/e.w;
 return reflectionHiZWalk((a.xy*0.5+vec2f(0.5))*size,(b.xy-a.xy)*0.5*size,a.z,b.z,size);
}`;
