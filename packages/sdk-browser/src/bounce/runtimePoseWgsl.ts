import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import {
  CORNER_INFLUENCES,
  PROXY_CHILDREN,
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../sdk-core/src/index.ts'
import { PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts'
import { RECORD_HEAD } from '../deformation/layout.ts'
import { RUNTIME_HEADER, RUNTIME_HEADER_WORDS } from './runtimeLayout.ts'

/** Threads of a workgroup of the pose: a corner or a node each. */
export const POSE_LANES = 64
/** Words of a pose's entry (`poseWords`). */
export const POSE_WORDS = 8

/**
 * THE POSE OF A DEFORMED PLACEMENT'S PROXY, on the GPU. A placement whose mesh deforms (a skin, morph targets)
 * is traced at its pose: it owns a copy of its mesh's proxy in the proxy's buffer (`gpu/dag/proxyInstances.ts`), and
 * this program moves the copy to where the deformation put the surface, in two steps:
 *
 * - `poseCorners`: one thread a corner of the copy's triangles. The corner stands on a vertex of the source mesh,
 *   whose four heaviest joints and weights and whose morph deltas the mesh's proxy kept (`CutDeformation`); the
 *   placement's record in the float pool (`deformation/layout.ts`) gives this frame's palette and morph weights.
 *   The morph targets move the rest vertex, the joints carry the result (the weights' blend, renormalised),
 *   in the order `deformWgsl.ts` gives the page vertices, and the point comes out in the mesh's own space,
 *   where its placement's world takes it on.
 * - `fitNodes`: the wide tree's bounds fitted again, one dispatch a level from the deepest to the root
 *   (`runtimePoseLevels.ts`), a thread a node. A node's exact bounds are the union of its children's — a leaf's
 *   triangles', an inner child's own, already fitted — and each child's quantized box is written again in the
 *   node's new bounds, rounded outward on the eight bits: a quantized box always contains what it contained,
 *   so no triangle disappears from a ray. The structure of the tree — its links, its counts — is the rest tree's.
 *
 * One entry a pose (`POSE_WORDS`): the rest and the posed copy's first triangle, how many, the posed copy's first
 * node and how many, the corner table's first word, the node levels' place in `order`, and the record's first
 * float in the pool plus one (zero: no record, the copy stays at rest).
 */
export const RUNTIME_POSE_SHADER = wgslProgram(
  `
${wgslConsts({
  HEADER: RUNTIME_HEADER_WORDS,
  TRIANGLES_WORD: RUNTIME_HEADER.trianglesWord,
  BOUNDS_WORD: RUNTIME_HEADER.boundsWord,
  CHILDREN_WORD: RUNTIME_HEADER.childrenWord,
  POSE_WORDS,
  LANES: POSE_LANES,
  RECORD_HEAD,
  PALETTE_FLOATS,
  INFLUENCES: CORNER_INFLUENCES,
  TRIANGLE_FLOATS: PROXY_TRIANGLE_FLOATS,
  NODE_FLOATS: PROXY_NODE_FLOATS,
  NODE_WORDS: PROXY_NODE_WORDS,
  CHILD_WORDS: PROXY_CHILD_WORDS,
  CHILDREN: PROXY_CHILDREN,
})}
@group(0) @binding(0) var<storage,read_write> arena:array<u32>;
@group(0) @binding(1) var<storage,read> pool:array<f32>;
@group(0) @binding(2) var<storage,read> poses:array<u32>;
@group(0) @binding(3) var<storage,read> order:array<u32>;
/** x: the level a fit dispatch serves; y: the poses. */
@group(0) @binding(4) var<uniform> step:vec4u;
fn arenaFloat(word:u32)->f32{return bitcast<f32>(arena[word]);}
fn arenaVec(word:u32)->vec3f{return vec3f(arenaFloat(word),arenaFloat(word+1u),arenaFloat(word+2u));}
/** Joint \`j\` of the palette at \`at\` (\`count\` joints, the last standing for a larger rank), its three rows. */
fn poseJoint(at:u32,j:u32,count:u32)->mat3x4f{
 let b=at+min(j,count-1u)*PALETTE_FLOATS;
 return mat3x4f(pool[b],pool[b+1u],pool[b+2u],pool[b+3u],
  pool[b+4u],pool[b+5u],pool[b+6u],pool[b+7u],
  pool[b+8u],pool[b+9u],pool[b+10u],pool[b+11u]);
}
/** The point \`rest\` of the corner whose table begins at \`corner\`, moved by the record at \`record\`: the
 *  morph targets, then the blend of the corner's joints. */
fn posePoint(record:u32,corner:u32,rest:vec3f)->vec3f{
 let joints=bitcast<u32>(pool[record+2u]);
 let targets=bitcast<u32>(pool[record+3u]);
 let palette=record+RECORD_HEAD;
 let weights=palette+2u*joints*PALETTE_FLOATS;
 var v=rest;
 for(var t=0u;t<targets;t++){
  v+=pool[weights+t]*arenaVec(corner+2u*INFLUENCES+3u*t);
 }
 if(joints==0u){return v;}
 var result=vec3f(0.0);
 var total=0.0;
 for(var k=0u;k<INFLUENCES;k++){
  let weight=arenaFloat(corner+INFLUENCES+k);
  total+=weight;
  if(weight!=0.0){result+=weight*(vec4f(v,1.0)*poseJoint(palette,u32(arenaFloat(corner+k)),joints));}
 }
 if(total>0.0){return result/total;}
 return v;
}
@compute @workgroup_size(LANES)
fn poseCorners(@builtin(global_invocation_id) id:vec3u){
 if(id.y>=step.y){return;}
 let entry=id.y*POSE_WORDS;
 let corner=id.x;
 if(corner>=poses[entry+2u]*3u){return;}
 let triangles=HEADER+arena[TRIANGLES_WORD];
 let rest=triangles+poses[entry]*TRIANGLE_FLOATS+corner*3u;
 let out=triangles+poses[entry+1u]*TRIANGLE_FLOATS+corner*3u;
 var v=arenaVec(rest);
 let record=poses[entry+7u];
 if(record!=0u){
  let head=record-1u;
  let width=2u*INFLUENCES+3u*bitcast<u32>(pool[head+3u]);
  v=posePoint(head,poses[entry+5u]+corner*width,v);
 }
 arena[out]=bitcast<u32>(v.x);
 arena[out+1u]=bitcast<u32>(v.y);
 arena[out+2u]=bitcast<u32>(v.z);
}
/** The box child \`slot\` of node \`node\` (of the copy whose first node is \`first\`, first triangle \`triangle\`) holds
 *  now: a leaf's triangles', an inner child's own bounds. */
struct PoseBox{low:vec3f,high:vec3f,}
fn childBox(first:u32,triangle:u32,base:u32)->PoseBox{
 let words=arena[base+1u];
 let count=(words>>16u)&255u;
 let offset=arena[base+2u];
 if(count==0u){
  let at=HEADER+arena[BOUNDS_WORD]+(first+offset)*NODE_FLOATS;
  return PoseBox(arenaVec(at),arenaVec(at+3u));
 }
 let triangles=HEADER+arena[TRIANGLES_WORD]+(triangle+offset)*TRIANGLE_FLOATS;
 var low=vec3f(3.4e38);
 var high=vec3f(-3.4e38);
 for(var corner=0u;corner<count*3u;corner++){
  let p=arenaVec(triangles+corner*3u);
  low=min(low,p);
  high=max(high,p);
 }
 return PoseBox(low,high);
}
/** The byte a coordinate takes in a node's bounds, rounded outward: down for a lower bound, up for an upper. */
fn quantized(x:f32,low:f32,span:f32,up:bool)->u32{
 if(!(span>0.0)){return select(0u,255u,up);}
 let t=(x-low)/span;
 return u32(clamp(select(floor(t-1e-3),ceil(t+1e-3),up),0.0,255.0));
}
@compute @workgroup_size(LANES)
fn fitNodes(@builtin(global_invocation_id) id:vec3u){
 if(id.y>=step.y){return;}
 let entry=id.y*POSE_WORDS;
 let place=poses[entry+6u];
 let levels=order[place];
 let level=step.x;
 if(level>=levels){return;}
 let at=id.x+order[place+1u+level];
 if(at>=order[place+2u+level]){return;}
 let node=order[place+2u+levels+at];
 let first=poses[entry+3u];
 let triangle=poses[entry+1u];
 let base=HEADER+arena[CHILDREN_WORD]+(first+node)*NODE_WORDS;
 var boxes:array<PoseBox,CHILDREN>;
 var low=vec3f(3.4e38);
 var high=vec3f(-3.4e38);
 for(var slot=0u;slot<CHILDREN;slot++){
  let child=base+slot*CHILD_WORDS;
  if((arena[child+1u]>>24u)==0u){continue;}
  boxes[slot]=childBox(first,triangle,child);
  low=min(low,boxes[slot].low);
  high=max(high,boxes[slot].high);
 }
 let bounds=HEADER+arena[BOUNDS_WORD]+(first+node)*NODE_FLOATS;
 for(var axis=0u;axis<3u;axis++){
  arena[bounds+axis]=bitcast<u32>(low[axis]);
  arena[bounds+3u+axis]=bitcast<u32>(high[axis]);
 }
 let span=(high-low)/255.0;
 for(var slot=0u;slot<CHILDREN;slot++){
  let child=base+slot*CHILD_WORDS;
  let words=arena[child+1u];
  if((words>>24u)==0u){continue;}
  let lowBytes=vec3u(quantized(boxes[slot].low.x,low.x,span.x,false),quantized(boxes[slot].low.y,low.y,span.y,false),quantized(boxes[slot].low.z,low.z,span.z,false));
  let highBytes=vec3u(quantized(boxes[slot].high.x,low.x,span.x,true),quantized(boxes[slot].high.y,low.y,span.y,true),quantized(boxes[slot].high.z,low.z,span.z,true));
  arena[child]=lowBytes.x|(lowBytes.y<<8u)|(lowBytes.z<<16u)|(highBytes.x<<24u);
  arena[child+1u]=highBytes.y|(highBytes.z<<8u)|(words&0xffff0000u);
 }
}`,
  [],
)
