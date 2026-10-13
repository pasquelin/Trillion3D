import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FINITE_SENTINEL } from '../../../math/src/wgsl/constants.ts'
import {
  CORNER_INFLUENCES,
  PROXY_CHILDREN,
  PROXY_TRIANGLE_FLOATS,
} from '../../../sdk-core/src/index.ts'
import {
  DEFORM_AT_WGSL,
  deformRecordFns,
  deformSkinFn,
  type DeformRecordSource,
} from '../deformation/deformWgsl.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { REFIT_LANES } from '../gpu/dag/treeRefitLevels.ts'
import { WIDE_CHILD_PACK_WGSL, wideNodeFns } from './nodeWgsl.ts'
import { RUNTIME_PROXY_WGSL } from './runtimeLayout.ts'

/** The pose's record reads: the deformation's float pool, bound as `pool` (`deformRecordFns`). */
const POSE_RECORD: DeformRecordSource = { source: 'pool', prefix: 'pose' }

/** Threads of a workgroup of the pose: a corner each, or a node (`REFIT_LANES`). */
export const POSE_LANES = REFIT_LANES
/** One pose's entry: the rest and the posed copy's first triangle and how many, the posed copy's first
 *  node and how many, the corner table's first word, and the record's first float in the pool plus one
 *  (zero: no record, the copy stays at rest). */
export const POSE_ENTRY = {
  rest: 0,
  posed: 1,
  triangles: 2,
  node: 3,
  nodes: 4,
  corners: 5,
  record: 6,
} as const
export const POSE_WORDS = Object.keys(POSE_ENTRY).length
/** Words of a level's parameters: the first of its nodes in the id list, how many, and the poses. */
export const POSE_STEP_WORDS = 4

/**
 * THE POSE OF A DEFORMED PLACEMENT'S PROXY, on the GPU. A placement whose mesh deforms (a skin, morph targets)
 * is traced at its pose: it owns a copy of its mesh's proxy in the proxy's buffer (`gpu/dag/proxyInstances.ts`), and
 * this program moves the copy to where the deformation put the surface, in two steps:
 *
 * - `poseCorners`: one thread a corner of the copy's triangles. The corner stands on a vertex of the source mesh,
 *   whose four heaviest joints and weights and whose morph deltas the mesh's proxy kept (`CutDeformation`); the
 *   placement's record in the float pool (`deformation/layout.ts`) gives this frame's palette and morph weights.
 *   The morph targets move the rest vertex, the joints carry the result (the weights' blend, renormalised),
 *   the record read and the joints blended by the very functions the page vertices are
 *   (`deformRecordFns`, `deformSkinFn`), and the point comes out in the mesh's own space, where its
 *   placement's world takes it on.
 * - `fitNodes`: the wide tree's bounds fitted again by the engine's one refit schedule (`refitLevels`,
 *   `gpu/dag/treeRefitLevels.ts`), a dispatch a level from the deepest, a thread a node of it — the level's
 *   nodes listed as (pose, node) pairs (`runtimePoseLevels.ts`). A node's exact bounds are the union of its
 *   children's — a leaf's triangles', an inner child's own, already fitted —, its children read as every
 *   wide tree's are (`wideNodeFns`) and their boxes written again in the node's new bounds by the codec's
 *   own rule (`wideChildPack`): a quantized box always contains what it contained, so no triangle disappears
 *   from a ray, and the bytes are the compiler's for the same box. The structure of the tree — its links,
 *   its counts — is the rest tree's.
 */
export const RUNTIME_POSE_SHADER = wgslProgram(
  `
${wgslConsts({
  POSE_WORDS,
  POSE_REST: POSE_ENTRY.rest,
  POSE_POSED: POSE_ENTRY.posed,
  POSE_TRIANGLES: POSE_ENTRY.triangles,
  POSE_NODE: POSE_ENTRY.node,
  POSE_CORNERS: POSE_ENTRY.corners,
  POSE_RECORD_WORD: POSE_ENTRY.record,
  LANES: POSE_LANES,
  INFLUENCES: CORNER_INFLUENCES,
  TRIANGLE_FLOATS: PROXY_TRIANGLE_FLOATS,
  CHILDREN: PROXY_CHILDREN,
})}
${RUNTIME_PROXY_WGSL}
@group(0) @binding(0) var<storage,read_write> arena:RuntimeProxy;
@group(0) @binding(1) var<storage,read> pool:array<f32>;
@group(0) @binding(2) var<storage,read> poses:array<u32>;
@group(0) @binding(3) var<storage,read> ids:array<u32>;
/** x: the level's first node in \`ids\`; y: how many; z: the poses. */
@group(0) @binding(4) var<uniform> step:vec4u;
fn arenaFloat(word:u32)->f32{return bitcast<f32>(arena.words[word]);}
fn arenaVec(word:u32)->vec3f{return vec3f(arenaFloat(word),arenaFloat(word+1u),arenaFloat(word+2u));}
${deformRecordFns(POSE_RECORD)}
${deformSkinFn(POSE_RECORD, {
  name: 'poseSkin',
  params: 'corner:u32',
  influences: 'INFLUENCES',
  weight: 'arenaFloat(corner+INFLUENCES+k)',
  joint: 'u32(arenaFloat(corner+k))',
})}
${wideNodeFns({ box: 'poseBox', child: 'poseChild', source: 'arena', float: 'arenaFloat' })}
/** The point \`rest\` of the corner whose table begins at \`corner\`, moved by the record \`a\`: the
 *  morph targets, then the blend of the corner's joints (\`deformSkinFn\`). */
fn posePoint(a:DeformAt,corner:u32,rest:vec3f)->vec3f{
 var v=rest;
 for(var t=0u;t<a.targets;t++){
  v+=pool[a.weights+t]*arenaVec(corner+2u*INFLUENCES+3u*t);
 }
 if(a.joints==0u){return v;}
 return poseSkin(corner,a.palette,a.joints,vec4f(v,1.0));
}
@compute @workgroup_size(LANES)
fn poseCorners(@builtin(global_invocation_id) id:vec3u){
 if(id.y>=step.z){return;}
 let entry=id.y*POSE_WORDS;
 let corner=id.x;
 if(corner>=poses[entry+POSE_TRIANGLES]*3u){return;}
 let rest=arena.trianglesWord+poses[entry+POSE_REST]*TRIANGLE_FLOATS+corner*3u;
 let out=arena.trianglesWord+poses[entry+POSE_POSED]*TRIANGLE_FLOATS+corner*3u;
 var v=arenaVec(rest);
 let record=poses[entry+POSE_RECORD_WORD];
 if(record!=0u){
  let a=poseAt(record-1u,false);
  let width=2u*INFLUENCES+3u*a.targets;
  v=posePoint(a,poses[entry+POSE_CORNERS]+corner*width,v);
 }
 arena.words[out]=bitcast<u32>(v.x);
 arena.words[out+1u]=bitcast<u32>(v.y);
 arena.words[out+2u]=bitcast<u32>(v.z);
}
/** The box child \`c\` of a node of the copy whose first node is \`first\` and first triangle \`triangle\`
 *  holds now: a leaf's triangles', an inner child's own bounds. */
fn poseChildBox(first:u32,triangle:u32,c:ProxyChild)->Box{
 if(c.count==0u){return poseBox(first+c.offset);}
 let triangles=arena.trianglesWord+(triangle+c.offset)*TRIANGLE_FLOATS;
 var low=vec3f(FINITE_SENTINEL);
 var high=vec3f(-FINITE_SENTINEL);
 for(var corner=0u;corner<c.count*3u;corner++){
  let p=arenaVec(triangles+corner*3u);
  low=min(low,p);
  high=max(high,p);
 }
 return Box(low,high);
}
@compute @workgroup_size(LANES)
fn fitNodes(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g,n,LANES);
 if(i>=step.y){return;}
 let item=2u*(step.x+i);
 let entry=ids[item]*POSE_WORDS;
 let first=poses[entry+POSE_NODE];
 let triangle=poses[entry+POSE_POSED];
 let node=first+ids[item+1u];
 // The children's links and counts, read as every wide tree's: their boxes are fitted below.
 let none=Box(vec3f(0.0),vec3f(0.0));
 var children:array<ProxyChild,CHILDREN>;
 var boxes:array<Box,CHILDREN>;
 var low=vec3f(FINITE_SENTINEL);
 var high=vec3f(-FINITE_SENTINEL);
 for(var slot=0u;slot<CHILDREN;slot++){
  children[slot]=poseChild(node,slot,none);
  if(!children[slot].present){continue;}
  boxes[slot]=poseChildBox(first,triangle,children[slot]);
  low=min(low,boxes[slot].low);
  high=max(high,boxes[slot].high);
 }
 let bounds=arena.boundsWord+node*NODE_FLOATS;
 for(var axis=0u;axis<3u;axis++){
  arena.words[bounds+axis]=bitcast<u32>(low[axis]);
  arena.words[bounds+3u+axis]=bitcast<u32>(high[axis]);
 }
 let frame=Box(low,high);
 for(var slot=0u;slot<CHILDREN;slot++){
  if(!children[slot].present){continue;}
  let packed=wideChildPack(frame,boxes[slot],children[slot].count,children[slot].offset);
  let at=arena.childrenWord+node*NODE_WORDS+slot*CHILD_WORDS;
  arena.words[at]=packed.x;
  arena.words[at+1u]=packed.y;
 }
}`,
  [DEFORM_AT_WGSL, WIDE_CHILD_PACK_WGSL, FLAT_INDEX_WGSL, FINITE_SENTINEL],
)
