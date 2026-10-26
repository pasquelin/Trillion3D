import { PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts'
import { FLAG_SKIN, FLAG_SOFT_SOURCE } from '../../../sdk-core/src/page/format.ts'
import { FLAG_VOXEL } from '../visibility/types.ts'
import { VOXEL_BRICK_CORNERS } from '../../../sdk-core/src/page/voxelPage.ts'
import {
  KIND_MORPH,
  KIND_SKIN,
  KIND_WAVE,
  KIND_SOFT,
  RECORD_HEAD,
  RECORD_WORD,
  WAVE_FLOATS,
  WORLD_BLOCK,
} from './layout.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'
import { worldMatrix3 } from '../../../math/src/wgsl/matrix.ts'
import { transformPoint } from '../../../math/src/wgsl/projection.ts'
import { CLUSTER_HEADER_WGSL } from '../geometry/cluster/headerWgsl.ts'
import { clusterDecodeWgsl } from '../geometry/cluster/decodeWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts'
import { PAGE_POINTS_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { WAVE_TERMS } from './waveTermsWgsl.ts'

/** Where a deformation record lies: the float storage that holds it, and the prefix its reads are
 *  named with (`deformRecordFns`). */
export type DeformRecordSource = { source: string; prefix: string }

/** Where record `r`'s parts start: palette, morph weights, world matrices, waves. */
const DEFORM_AT_WGSL = wgslBlock(
  'DEFORM_AT_WGSL',
  [],
  'struct DeformAt{kinds:u32,joints:u32,targets:u32,waves:u32,palette:u32,weights:u32,world:u32,wave:u32,soft:u32,simulation:u32,}',
)

/**
 * THE READS OF A DEFORMATION RECORD (`layout.ts`), written once for every storage a record lies in —
 * the passes' float pool (`positions`) —: a word of
 * it, joint `j` of the palette at `at` (`count` joints, the last one standing for a larger rank),
 * its three rows, and where the record's parts start (`DeformAt`), this frame's or the last one's.
 */
const deformRecordFns = ({
  source,
  prefix,
}: DeformRecordSource) => `fn ${prefix}Word(at:u32)->u32{return bitcast<u32>(${source}[at]);}
fn ${prefix}Joint(at:u32,j:u32,count:u32)->mat3x4f{
 let b=at+min(j,count-1u)*${PALETTE_FLOATS}u;
 return mat3x4f(${source}[b],${source}[b+1u],${source}[b+2u],${source}[b+3u],
  ${source}[b+4u],${source}[b+5u],${source}[b+6u],${source}[b+7u],
  ${source}[b+8u],${source}[b+9u],${source}[b+10u],${source}[b+11u]);
}
fn ${prefix}At(r:u32,previous:bool)->DeformAt{
 var a:DeformAt;
 a.kinds=${prefix}Word(r+select(${RECORD_WORD.kinds}u,${RECORD_WORD.previousKinds}u,previous));
 a.joints=${prefix}Word(r+${RECORD_WORD.joints}u);a.targets=${prefix}Word(r+${RECORD_WORD.targets}u);a.waves=${prefix}Word(r+${RECORD_WORD.waves}u);
 a.palette=r+${RECORD_HEAD}u+select(0u,a.joints*${PALETTE_FLOATS}u,previous);
 a.weights=r+${RECORD_HEAD}u+2u*a.joints*${PALETTE_FLOATS}u;
 a.world=a.weights+2u*a.targets;a.wave=a.world+${WORLD_BLOCK.floats}u;
 a.soft=${prefix}Word(r+${RECORD_WORD.soft}u);a.simulation=a.world+select(0u,${WORLD_BLOCK.floats}u,a.waves>0u)+2u*a.waves*${WAVE_FLOATS}u;
 a.world+=select(0u,${WORLD_BLOCK.previous}u,previous);
 a.weights+=select(0u,a.targets,previous);
 return a;
}`

/**
 * THE BLEND OF A PALETTE'S JOINTS, written once for every vertex a record moves — a page's
 * (`deformSkin`) —: a point (`w` 1) or a direction
 * (`w` 0) carried by the weighed sum of its joints, renormalised by the weights' total, untouched
 * where they sum to none. `weight` and `joint` are the expressions of influence `k`'s weight and
 * joint, over the function's own `params`.
 */
const deformSkinFn = (
  { prefix }: DeformRecordSource,
  {
    name,
    params,
    influences,
    weight,
    joint,
  }: { name: string; params: string; influences: string; weight: string; joint: string },
) => `fn ${name}(${params},at:u32,count:u32,v:vec4f)->vec3f{
 var result=vec3f(0.0);var total=0.0;
 for(var k=0u;k<${influences};k++){
  let weight=${weight};total+=weight;
  if(weight!=0.0){result+=weight*(v*${prefix}Joint(at,${joint},count));}
 }
 if(total>0.0){return result/total;}return v.xyz;
}`

/** The passes' record reads: the float pool every pass binds as `positions`. */
const PAGE_RECORD: DeformRecordSource = { source: 'positions', prefix: 'deform' }

/**
 * THE GPU DEFORMATION STAGE, in WGSL: a page vertex moved by its placement's record
 * (`layout.ts`) before any pass reads it — the one routine `pagePosition` and `pageNormal` call,
 * so the visibility raster, the compute raster, the shadow depth, the surface resolve, the
 * transparent draw and the temporal pass read the same deformed surface. `previous` reads the
 * last frame's record: where the vertex was, which the temporal pass reprojects a pixel by.
 *
 * In this order: the morph targets move the rest vertex, the joints carry the result
 * (linear blend of every palette influence; a brick's box corners by its one joint, rigidly, so the
 * box stays a box its voxels are traced through at rest, `voxelCarry`), then the waves carry the
 * world point to where
 * the trochoidal sum puts it — `waveTerms` of `sdk-core/src/fluids/waves.ts`, printed into WGSL
 * (`waveTermsWgsl.ts`), on the same numbers.
 * The record lives in the float pool the passes already bind (`positions`), after its vertices:
 * no binding is added to any pass.
 */
export const DEFORM_WGSL = wgslBlock(
  'DEFORM_WGSL',
  [
    DEFORM_AT_WGSL,
    worldMatrix3,
    transformPoint,
    unitOrZero,
    PAGE_INFO_STRUCT_WGSL,
    CLUSTER_HEADER_WGSL,
    clusterDecodeWgsl('indices'),
    PAGE_POINTS_WGSL,
  ],
  `
fn deformJointId(h:ClusterHeader,page:PageInfo,vertex:u32,k:u32)->u32{
 return clusterJoint(h,page.pageOffset,vertex,k);
}
fn deformWeight(h:ClusterHeader,page:PageInfo,vertex:u32,k:u32)->f32{
 return clusterWeight(h,page.pageOffset,vertex,k);
}
fn deformMorphValue(h:ClusterHeader,page:PageInfo,t:u32,vertex:u32,normal:bool)->vec3f{
 return clusterMorph(h,page.pageOffset,t,vertex,normal);
}
${deformRecordFns(PAGE_RECORD)}
/** A point (\`w\` 1) or a direction (\`w\` 0) carried by the palette's blend of all joints. */
${deformSkinFn(PAGE_RECORD, {
  name: 'deformSkin',
  params: 'h:ClusterHeader,page:PageInfo,vertex:u32',
  influences: 'h.influences',
  weight: 'deformWeight(h,page,vertex,k)',
  joint: 'deformJointId(h,page,vertex,k)',
})}
fn deformMatrix(at:u32)->mat4x4f{
 return mat4x4f(positions[at],positions[at+1u],positions[at+2u],positions[at+3u],
  positions[at+4u],positions[at+5u],positions[at+6u],positions[at+7u],
  positions[at+8u],positions[at+9u],positions[at+10u],positions[at+11u],
  positions[at+12u],positions[at+13u],positions[at+14u],positions[at+15u]);
}
/** A vertex as the deformation leaves it: its point, its unit normal and its unit tangent, zero where
 *  the vertex has none. A partial result (the waves', the soft body's) holds no tangent. */
struct DeformedVertex{p:vec3f,n:vec3f,t:vec3f,}
/** Tangent \`t\` turned to lie across the normal \`n\`: what the tangent loses along it, made unit. */
fn deformTangent(t:vec3f,n:vec3f)->vec3f{
 let unit=unitOrZero(n);
 return unitOrZero(t-dot(t,unit)*unit);
}
/** The trochoidal sum at the world point \`p\` (\`count\` waves from \`at\`), at this frame's phases
 *  or the last one's: in one walk, its displacement (\`p\`) and its unit normal (\`n\`). */
fn deformWaves(at:u32,count:u32,p:vec3f,previous:bool)->DeformedVertex{
 var d=vec3f(0.0);var n=vec3f(0.0,1.0,0.0);
 for(var i=0u;i<count;i++){
  let b=at+i*${WAVE_FLOATS}u+select(0u,count*${WAVE_FLOATS}u,previous);
  ${WAVE_TERMS}
 }
 return DeformedVertex(d,normalize(n),vec3f(0.0));
}
fn deformVec(at:u32)->vec3f{return vec3f(positions[at],positions[at+1u],positions[at+2u]);}
/** The soft body's share in one walk of the influences: its displacement of the point (\`p\`, this
 *  frame's or the last one's) and the normal it gives (\`n\`). */
fn deformSoft(a:DeformAt,h:ClusterHeader,page:PageInfo,vertex:u32,previous:bool)->DeformedVertex{
 var delta=vec3f(0.0);var normal=vec3f(0.0);let count=a.soft*3u;
 for(var k=0u;k<h.influences;k++){
  let start=a.simulation+min(deformJointId(h,page,vertex,k),a.soft-1u)*3u;
  let weight=deformWeight(h,page,vertex,k);
  delta+=weight*(deformVec(start+select(0u,count,previous))-deformVec(start+count*2u));
  normal+=weight*deformVec(start+count*3u);
 }
 return DeformedVertex(delta,normal,vec3f(0.0));
}
/** Vertex \`vertex\` of the page, at rest point \`rest\`, rest normal \`normal\` and rest tangent
 *  \`tangent\` (zero for a page that stores none), where its placement's deformation carries it this
 *  frame, or the last one with \`previous\`: the soft body or the targets move it, the joints carry
 *  it, the waves carry its world point and give the normal there, taken back to the page's frame.
 *  Wherever the normal changes by more than a rotation — the soft body's, the targets' sum made
 *  unit, the waves' — the tangent is turned across the new normal (\`deformTangent\`); the joints
 *  then carry both. Untouched on a row with no record. */
fn deformVertex(page:PageInfo,h:ClusterHeader,vertex:u32,rest:vec3f,normal:vec3f,tangent:vec3f,previous:bool)->DeformedVertex{
 if(page.deform==0u){return DeformedVertex(rest,normal,tangent);}
 let a=deformAt(page.deform-1u,previous);
 var p=rest;var n=normal;var t=tangent;
 if((a.kinds&${KIND_SOFT}u)!=0u&&(h.flags&${FLAG_SOFT_SOURCE}u)!=0u){let s=deformSoft(a,h,page,vertex,previous);p+=s.p;n=s.n;t=deformTangent(t,n);}
 if((a.kinds&${KIND_MORPH}u)!=0u){
  for(var k=0u;k<min(a.targets,h.morphCount);k++){
   let weight=positions[a.weights+k];
   if(weight!=0.0){p+=weight*deformMorphValue(h,page,k,vertex,false);n+=weight*deformMorphValue(h,page,k,vertex,true);}
  }
  n=unitOrZero(n);t=deformTangent(t,n);
 }
 if((a.kinds&${KIND_SKIN}u)!=0u&&(h.flags&${FLAG_SKIN}u)!=0u){
  p=deformSkin(h,page,vertex,a.palette,a.joints,vec4f(p,1.0));n=deformSkin(h,page,vertex,a.palette,a.joints,vec4f(n,0.0));
  t=deformSkin(h,page,vertex,a.palette,a.joints,vec4f(t,0.0));
 }
 if((a.kinds&${KIND_SKIN}u)!=0u&&(page.flags&${FLAG_VOXEL}u)!=0u){
  let joint=voxelJoint(page.pageOffset,vertex/${VOXEL_BRICK_CORNERS}u);
  if(joint!=0xFFFFu){let m=deformJoint(a.palette,joint,a.joints);p=vec4f(p,1.0)*m;n=vec4f(n,0.0)*m;t=vec4f(t,0.0)*m;}
 }
 if((a.kinds&${KIND_WAVE}u)!=0u){
  let m=deformMatrix(a.world);let world=transformPoint(m,p);
  let w=deformWaves(a.wave,a.waves,world,previous);
  p=transformPoint(deformMatrix(a.world+${WORLD_BLOCK.inverse}u),world+w.p);n=transpose(worldMatrix3(m))*w.n;t=deformTangent(t,n);
 }
 return DeformedVertex(p,normalize(n),unitOrZero(t));
}`,
)
