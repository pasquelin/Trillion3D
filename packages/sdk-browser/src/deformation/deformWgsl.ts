import { PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts';
import { FLAG_SKIN, FLAG_SOFT_SOURCE } from '../cluster/format.ts';
import { KIND_MORPH, KIND_SKIN, KIND_WAVE, KIND_SOFT, RECORD_HEAD, WAVE_FLOATS } from './layout.ts';

/**
 * THE GPU DEFORMATION STAGE (#357), in WGSL: a page vertex moved by its placement's record
 * (`layout.ts`) before any pass reads it — the one routine `pagePosition` and `pageNormal` call,
 * so the visibility raster, the compute raster, the shadow depth, the surface resolve, the
 * transparent draw and the temporal pass read the same deformed surface. `previous` reads the
 * last frame's record: where the vertex was, which the temporal pass reprojects a pixel by.
 *
 * In the reference's order: the morph targets move the rest vertex, the joints carry the result
 * (linear blend of every palette influence), then the waves carry the world point to where
 * the Gerstner sum puts it — the formula of `sdk-core/src/fluids/waves.ts`, on the same numbers.
 * The record lives in the float pool the passes already bind (`positions`), after its vertices:
 * no binding is added to any pass.
 */
export const DEFORM_WGSL = `
fn wholeVertex(page:PageInfo,vertex:u32)->u32{
 let start=page.packedBase-1u;return start+4u+vertex*u32(positions[start+3u]);
}
fn deformJointId(h:ClusterHeader,page:PageInfo,vertex:u32,k:u32)->u32{
 if((page.deformOutput&0x80000000u)==0u){return clusterJoint(h,page.pageOffset,vertex,k);}
 return u32(positions[wholeVertex(page,vertex)+k]);
}
fn deformWeight(h:ClusterHeader,page:PageInfo,vertex:u32,k:u32)->f32{
 if((page.deformOutput&0x80000000u)==0u){return clusterWeight(h,page.pageOffset,vertex,k);}
 return positions[wholeVertex(page,vertex)+h.influences+k];
}
fn deformMorphValue(h:ClusterHeader,page:PageInfo,t:u32,vertex:u32,normal:bool)->vec3f{
 if((page.deformOutput&0x80000000u)==0u){return clusterMorph(h,page.pageOffset,t,vertex,normal);}
 let at=wholeVertex(page,vertex)+h.influences*2u+t*6u+select(0u,3u,normal);
 return vec3f(positions[at],positions[at+1u],positions[at+2u]);
}
fn deformWord(at:u32)->u32{return bitcast<u32>(positions[at]);}
/** Joint \`j\` of the palette at \`at\` (\`count\` joints, the last one standing for a larger rank),
 *  its three rows. */
fn deformJoint(at:u32,j:u32,count:u32)->mat3x4f{
 let b=at+min(j,count-1u)*${PALETTE_FLOATS}u;
 return mat3x4f(positions[b],positions[b+1u],positions[b+2u],positions[b+3u],
  positions[b+4u],positions[b+5u],positions[b+6u],positions[b+7u],
  positions[b+8u],positions[b+9u],positions[b+10u],positions[b+11u]);
}
/** A point (\`w\` 1) or a direction (\`w\` 0) carried by the palette's blend of all joints. */
fn deformSkin(h:ClusterHeader,page:PageInfo,vertex:u32,at:u32,count:u32,v:vec4f)->vec3f{
 var result=vec3f(0.0);var total=0.0;
 for(var k=0u;k<h.influences;k++){
  let weight=deformWeight(h,page,vertex,k);total+=weight;
  if(weight!=0.0){result+=weight*(v*deformJoint(at,deformJointId(h,page,vertex,k),count));}
 }
 if(total>0.0){return result/total;}return v.xyz;
}
fn deformMatrix(at:u32)->mat4x4f{
 return mat4x4f(positions[at],positions[at+1u],positions[at+2u],positions[at+3u],
  positions[at+4u],positions[at+5u],positions[at+6u],positions[at+7u],
  positions[at+8u],positions[at+9u],positions[at+10u],positions[at+11u],
  positions[at+12u],positions[at+13u],positions[at+14u],positions[at+15u]);
}
/** The Gerstner sum at the world point \`p\` (\`count\` waves from \`at\`): its displacement, or with
 *  \`normal\` its unit normal, at this frame's phases or the last one's. */
fn deformWaves(at:u32,count:u32,p:vec3f,previous:bool,normal:bool)->vec3f{
 var d=vec3f(0.0);var n=vec3f(0.0,1.0,0.0);
 for(var i=0u;i<count;i++){
  let b=at+i*${WAVE_FLOATS}u+select(0u,count*${WAVE_FLOATS}u,previous);let dx=positions[b];let dz=positions[b+1u];let k=positions[b+2u];
  let amplitude=positions[b+3u];let lateral=positions[b+4u];let phase=positions[b+5u];
  let f=k*(dx*p.x+dz*p.z)-phase;let c=cos(f);let s=sin(f);
  d+=vec3f(lateral*dx*c,amplitude*s,lateral*dz*c);
  n-=vec3f(dx*k*amplitude*c,k*lateral*s,dz*k*amplitude*c);
 }
 return select(d,normalize(n),normal);
}
/** Where record \`r\`'s parts start: palette, morph weights, world matrices, waves. */
struct DeformAt{kinds:u32,joints:u32,targets:u32,waves:u32,palette:u32,weights:u32,world:u32,wave:u32,soft:u32,simulation:u32,}
fn deformAt(r:u32,previous:bool)->DeformAt{
 var a:DeformAt;
 a.kinds=deformWord(r+select(0u,1u,previous));a.joints=deformWord(r+2u);a.targets=deformWord(r+3u);a.waves=deformWord(r+4u);
 a.palette=r+${RECORD_HEAD}u+select(0u,a.joints*${PALETTE_FLOATS}u,previous);
 a.weights=r+${RECORD_HEAD}u+2u*a.joints*${PALETTE_FLOATS}u;
 a.world=a.weights+2u*a.targets;a.wave=a.world+64u;
 a.soft=deformWord(r+5u);a.simulation=a.world+select(0u,64u,a.waves>0u)+2u*a.waves*${WAVE_FLOATS}u;
 a.world+=select(0u,32u,previous);
 a.weights+=select(0u,a.targets,previous);
 return a;
}
fn deformSoft(a:DeformAt,h:ClusterHeader,page:PageInfo,vertex:u32,previous:bool,normal:bool)->vec3f{
 var delta=vec3f(0.0);let count=a.soft*3u;
 for(var k=0u;k<h.influences;k++){
  let v=min(deformJointId(h,page,vertex,k),a.soft-1u)*3u;let start=a.simulation+v;
  let current=start+select(select(0u,count,previous),count*3u,normal);
  let value=vec3f(positions[current],positions[current+1u],positions[current+2u]);
  let rest=start+count*2u;
  let origin=vec3f(positions[rest],positions[rest+1u],positions[rest+2u]);
  delta+=deformWeight(h,page,vertex,k)*select(value-origin,value,normal);
 }
 return delta;
}
/** The rest point \`rest\` of vertex \`vertex\` of the page, where its placement's deformation
 *  carries it this frame, or the last one with \`previous\`; untouched on a row with no record. */
fn deformPoint(page:PageInfo,h:ClusterHeader,vertex:u32,rest:vec3f,previous:bool)->vec3f{
 if(page.deform==0u){return rest;}
 let a=deformAt(page.deform-1u,previous);
 var p=rest;
 if((a.kinds&${KIND_SOFT}u)!=0u&&(h.flags&${FLAG_SOFT_SOURCE}u)!=0u){p+=deformSoft(a,h,page,vertex,previous,false);}
 if((a.kinds&${KIND_MORPH}u)!=0u){
  for(var t=0u;t<min(a.targets,h.morphCount);t++){
   let weight=positions[a.weights+t];
   if(weight!=0.0){p+=weight*deformMorphValue(h,page,t,vertex,false);}
  }
 }
 if((a.kinds&${KIND_SKIN}u)!=0u&&(h.flags&${FLAG_SKIN}u)!=0u){p=deformSkin(h,page,vertex,a.palette,a.joints,vec4f(p,1.0));}
 if((a.kinds&${KIND_WAVE}u)!=0u){
  let world=(deformMatrix(a.world)*vec4f(p,1.0)).xyz;
  p=(deformMatrix(a.world+16u)*vec4f(world+deformWaves(a.wave,a.waves,world,previous,false),1.0)).xyz;
 }
 return p;
}
/** The rest normal \`rest\` of the vertex, turned as \`deformPoint\` moves its point: the targets'
 *  normal displacements, the joints' turn, then the waves' normal taken back to the page's frame. */
fn deformNormal(page:PageInfo,h:ClusterHeader,vertex:u32,rest:vec3f)->vec3f{
 if(page.deform==0u){return rest;}
 let a=deformAt(page.deform-1u,false);
 var n=rest;
 if((a.kinds&${KIND_SOFT}u)!=0u&&(h.flags&${FLAG_SOFT_SOURCE}u)!=0u){n=deformSoft(a,h,page,vertex,false,true);}
 if((a.kinds&${KIND_MORPH}u)!=0u){
  for(var t=0u;t<min(a.targets,h.morphCount);t++){
   let weight=positions[a.weights+t];
   if(weight!=0.0){n+=weight*deformMorphValue(h,page,t,vertex,true);}
  }
 }
 if((a.kinds&${KIND_SKIN}u)!=0u&&(h.flags&${FLAG_SKIN}u)!=0u){n=deformSkin(h,page,vertex,a.palette,a.joints,vec4f(n,0.0));}
 if((a.kinds&${KIND_WAVE}u)!=0u){
  let rest=pageRestPosition(page,h,vertex);
  let m=deformMatrix(a.world);
  let world=(m*vec4f(rest,1.0)).xyz;
  n=transpose(mat3x3f(m[0].xyz,m[1].xyz,m[2].xyz))*deformWaves(a.wave,a.waves,world,false,true);
 }
 return normalize(n);
}`;
