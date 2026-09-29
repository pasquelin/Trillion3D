import { PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts';
import { FLAG_SKIN } from '../cluster/format.ts';
import { KIND_MORPH, KIND_SKIN, KIND_WAVE, RECORD_HEAD, WAVE_FLOATS } from './layout.ts';

/**
 * THE GPU DEFORMATION STAGE (#357), in WGSL: a page vertex moved by its placement's record
 * (`layout.ts`) before any pass reads it — the one routine `pagePosition` and `pageNormal` call,
 * so the visibility raster, the compute raster, the shadow depth, the surface resolve, the
 * transparent draw and the temporal pass read the same deformed surface. `previous` reads the
 * last frame's record: where the vertex was, which the temporal pass reprojects a pixel by.
 *
 * In the reference's order: the morph targets move the rest vertex, the joints carry the result
 * (linear blend of the palette, four weights), then the waves carry the world point to where
 * the Gerstner sum puts it — the formula of `sdk-core/src/fluids/waves.ts`, on the same numbers.
 * The record lives in the float pool the passes already bind (`positions`), after its vertices:
 * no binding is added to any pass.
 */
export const DEFORM_WGSL = `
fn deformWord(at:u32)->u32{return bitcast<u32>(positions[at]);}
/** Joint \`j\` of the palette at \`at\` (\`count\` joints, the last one standing for a larger rank),
 *  its three rows. */
fn deformJoint(at:u32,j:u32,count:u32)->mat3x4f{
 let b=at+min(j,count-1u)*${PALETTE_FLOATS}u;
 return mat3x4f(positions[b],positions[b+1u],positions[b+2u],positions[b+3u],
  positions[b+4u],positions[b+5u],positions[b+6u],positions[b+7u],
  positions[b+8u],positions[b+9u],positions[b+10u],positions[b+11u]);
}
/** A point (\`w\` 1) or a direction (\`w\` 0) carried by the palette's blend of four joints. */
fn deformSkin(h:ClusterHeader,page:PageInfo,vertex:u32,at:u32,count:u32,v:vec4f)->vec3f{
 let j=clusterJoints(h,page.pageOffset,vertex);let w=clusterWeights(h,page.pageOffset,vertex);
 return w.x*(v*deformJoint(at,j.x,count))+w.y*(v*deformJoint(at,j.y,count))
  +w.z*(v*deformJoint(at,j.z,count))+w.w*(v*deformJoint(at,j.w,count));
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
  let b=at+i*${WAVE_FLOATS}u;let dx=positions[b];let dz=positions[b+1u];let k=positions[b+2u];
  let amplitude=positions[b+3u];let lateral=positions[b+4u];let phase=positions[b+select(5u,6u,previous)];
  let f=k*(dx*p.x+dz*p.z)-phase;let c=cos(f);let s=sin(f);
  d+=vec3f(lateral*dx*c,amplitude*s,lateral*dz*c);
  n-=vec3f(dx*k*amplitude*c,k*lateral*s,dz*k*amplitude*c);
 }
 return select(d,normalize(n),normal);
}
/** Where record \`r\`'s parts start: palette, morph weights, world matrices, waves. */
struct DeformAt{kinds:u32,joints:u32,targets:u32,waves:u32,palette:u32,weights:u32,world:u32,wave:u32,}
fn deformAt(r:u32,previous:bool)->DeformAt{
 var a:DeformAt;
 a.kinds=deformWord(r+select(0u,1u,previous));a.joints=deformWord(r+2u);a.targets=deformWord(r+3u);a.waves=deformWord(r+4u);
 a.palette=r+${RECORD_HEAD}u+select(0u,a.joints*${PALETTE_FLOATS}u,previous);
 a.weights=r+${RECORD_HEAD}u+2u*a.joints*${PALETTE_FLOATS}u;
 a.world=a.weights+2u*a.targets;a.wave=a.world+32u;
 a.weights+=select(0u,a.targets,previous);
 return a;
}
/** The rest point \`rest\` of vertex \`vertex\` of the page, where its placement's deformation
 *  carries it this frame, or the last one with \`previous\`; untouched on a row with no record. */
fn deformPoint(page:PageInfo,h:ClusterHeader,vertex:u32,rest:vec3f,previous:bool)->vec3f{
 if(page.deform==0u){return rest;}
 let a=deformAt(page.deform-1u,previous);
 var p=rest;
 if((a.kinds&${KIND_MORPH}u)!=0u){
  for(var t=0u;t<min(a.targets,h.morphCount);t++){
   let weight=positions[a.weights+t];
   if(weight!=0.0){p+=weight*clusterMorph(h,page.pageOffset,t,vertex,false);}
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
 if((a.kinds&${KIND_MORPH}u)!=0u){
  for(var t=0u;t<min(a.targets,h.morphCount);t++){
   let weight=positions[a.weights+t];
   if(weight!=0.0){n+=weight*clusterMorph(h,page.pageOffset,t,vertex,true);}
  }
 }
 if((a.kinds&${KIND_SKIN}u)!=0u&&(h.flags&${FLAG_SKIN}u)!=0u){n=deformSkin(h,page,vertex,a.palette,a.joints,vec4f(n,0.0));}
 if((a.kinds&${KIND_WAVE}u)!=0u){
  let rest=pageRestPosition(page,h,vertex);
  let world=(deformMatrix(a.world)*vec4f(rest,1.0)).xyz;
  let m=deformMatrix(a.world);
  n=transpose(mat3x3f(m[0].xyz,m[1].xyz,m[2].xyz))*deformWaves(a.wave,a.waves,world,false,true);
 }
 return normalize(n);
}`;
