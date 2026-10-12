/**
 * THE PLACEMENT TREE REFIT, in the shader (`treeRefit.ts`): the boxes of the nodes a change touched,
 * bottom up, each the CPU build's to the word (`fitPlacementTree`, `placementTree.ts`). A group's box
 * is the union of its members' leaf boxes — doubles, `members` six a placement, `memberBox` or a
 * composition's own —, a cell's the union of its children's boxes as the nodes hold them; both grown
 * by `MARGIN` of the farthest coordinate and the widest side, then stored as single precision. A node
 * is open — the box no plane rejects — when one of its members is never culled or deformed by a
 * reach (its mark), or one of its children is open: an open box is what `OPEN` bounds say, read back
 * as such. A parked member, or a slot no placement holds, holds nothing.
 *
 *   params      uniform        the level's first id, how many, and what it fits (below)
 *   ids         array<u32>     the nodes of the level to fit, as their index within it
 *   nodes       array<u32>     the tree's nodes, `DAG_NODE_FLOATS` words each, written
 *   members     array<vec2u>   each placement's leaf box, six doubles
 *   frames      array<u32>     each placement's frame words: its root, its mark
 *   cold        array<u32>     the order of the members, from `params.members`
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { dAbs, dAdd, dLess, dMax, dMin, dMul, dSub } from '../../../../math/src/wgsl/double.ts'
import { fromF32, toF32 } from '../../../../math/src/wgsl/f32.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../dispatch/grid.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { SELECTION_NONE } from '../core/selection.ts'
import { FRAME_ROW_WORDS, DAG_NODE_FLOATS } from './types.ts'
import { MARGIN, OPEN, TREE_SPAN } from './placementTree.ts'
import { NODE_MAX, NODE_MIN } from './nodeLayout.ts'

/** Where a placement's root and its mark lie in its frame row (`primitiveFrameWords`). */
const FRAME_ROOT = 1,
  FRAME_MARK = 3

const f32Bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]
/** The bits of the bound an open node holds, and of an empty one's. */
export const OPEN_LOW_BITS = f32Bits(-OPEN),
  OPEN_HIGH_BITS = f32Bits(OPEN)
/** What the shader reads a level's parameters as: words of `Params`. */
export const REFIT_PARAM_WORDS = 8

/** The high word of the margin, a power of two: its double's low word is zero. */
const MARGIN_HIGH = new Uint32Array(new Float64Array([MARGIN]).buffer)[1]

/** The node `n` written from the doubles `lo` and `hi`, open or as fitted. */
const WRITE_BOX_WGSL = wgslBlock(
  'WRITE_BOX_WGSL',
  [dAdd, dSub, dMul, dLess, dMax, dAbs, toF32],
  `
fn writeBox(n:u32,opened:bool,lo:array<vec2u,3>,hi:array<vec2u,3>){
 let at=n*${DAG_NODE_FLOATS}u;
 let empty=dLess(hi[0],lo[0])||dLess(hi[1],lo[1])||dLess(hi[2],lo[2]);
 if(opened||empty){
  let low=select(${OPEN_HIGH_BITS}u,${OPEN_LOW_BITS}u,opened);
  let high=low^0x80000000u;
  for(var a=0u;a<3u;a++){nodes[at+${NODE_MIN}u+a]=low;nodes[at+${NODE_MAX}u+a]=high;}
  return;
 }
 var reach=vec2u(0u,0u);
 for(var a=0u;a<3u;a++){
  reach=dMax(reach,dMax(dAbs(lo[a]),dAbs(hi[a])));
  reach=dMax(reach,dSub(hi[a],lo[a]));
 }
 let grown=dMul(reach,vec2u(${MARGIN_HIGH}u,0u));
 for(var a=0u;a<3u;a++){
  nodes[at+${NODE_MIN}u+a]=toF32(dSub(lo[a],grown));
  nodes[at+${NODE_MAX}u+a]=toF32(dAdd(hi[a],grown));
 }
}`,
)

const FIT_WGSL = wgslBlock(
  'FIT_WGSL',
  [WRITE_BOX_WGSL, fromF32, dMin, dMax],
  `
fn fitGroup(j:u32){
 let first=j*${TREE_SPAN}u;
 var gm=0u;
 if(params.live>first){gm=min(params.live-first,${TREE_SPAN}u);}
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){lo[a]=vec2u(0x7ff00000u,0u);hi[a]=vec2u(0xfff00000u,0u);}
 var opened=false;
 for(var k=0u;k<gm&&!opened;k++){
  let w=cold[params.members+first+k];
  if(w==${SELECTION_NONE}u){continue;}
  let row=w*${FRAME_ROW_WORDS}u;
  if(frames[row+${FRAME_ROOT}u]==${SELECTION_NONE}u){continue;}
  let mark=frames[row+${FRAME_MARK}u];
  if((mark&${SPRITE_UNCULLED}u)!=0u||(mark>>16u)!=0u){opened=true;continue;}
  for(var a=0u;a<3u;a++){
   lo[a]=dMin(lo[a],members[w*6u+a]);
   hi[a]=dMax(hi[a],members[w*6u+3u+a]);
  }
 }
 writeBox(params.base+j,opened,lo,hi);
}
fn fitCell(j:u32){
 let first=j*${TREE_SPAN}u;
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){lo[a]=vec2u(0x7ff00000u,0u);hi[a]=vec2u(0xfff00000u,0u);}
 var opened=false;
 let end=min(first+${TREE_SPAN}u,params.childCount);
 for(var c=first;c<end&&!opened;c++){
  let at=(params.childBase+c)*${DAG_NODE_FLOATS}u;
  if(nodes[at+${NODE_MIN}u]==${OPEN_LOW_BITS}u){opened=true;continue;}
  for(var a=0u;a<3u;a++){
   lo[a]=dMin(lo[a],fromF32(nodes[at+${NODE_MIN}u+a]));
   hi[a]=dMax(hi[a],fromF32(nodes[at+${NODE_MAX}u+a]));
  }
 }
 writeBox(params.base+j,opened,lo,hi);
}`,
)

/**
 * One thread per node of a level: the group or the cell `ids` names, fitted. Its dispatches run
 * bottom up in one pass: the level above reads the boxes the one below wrote.
 */
export const TREE_REFIT_WGSL = wgslProgram(
  `struct Params{first:u32,count:u32,base:u32,live:u32,members:u32,childBase:u32,childCount:u32,cells:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> ids:array<u32>;
@group(0) @binding(2) var<storage,read_write> nodes:array<u32>;
@group(0) @binding(3) var<storage,read> members:array<vec2u>;
@group(0) @binding(4) var<storage,read> frames:array<u32>;
@group(0) @binding(5) var<storage,read> cold:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g,n,64u);if(i>=params.count){return;}
 let j=ids[params.first+i];
 if(params.cells==0u){fitGroup(j);}else{fitCell(j);}
}`,
  [FLAT_INDEX_WGSL, FIT_WGSL],
)
