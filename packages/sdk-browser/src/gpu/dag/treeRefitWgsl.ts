/**
 * THE PLACEMENT TREE REFIT, in the shader (`treeRefit.ts`): the boxes of the nodes a change touched,
 * bottom up. A group's box is the union of its members' leaf boxes — doubles, `members` six a
 * placement, the GPU's (`../../placement/treeLeavesWgsl.ts`) —, a cell's the union of its children's
 * boxes as the nodes hold them; both grown by `MARGIN` of the farthest coordinate and the widest
 * side, then stored as single precision. Every box is finite: a member's leaf holds its
 * deformation's reach, and one drawn whatever the view is opened from queue 0, never by its group
 * (`placementTree.ts`). A parked member, or a
 * slot no placement holds, holds nothing; a node that holds nothing takes the empty box, its bounds
 * crossed at the finite sentinel (`FINITE_SENTINEL`), which every union passes over.
 *
 * Group 0 binds the tree's record table (`treeTable.ts`) as a storage texture read and written in
 * place — the WGSL feature `readonly_and_readwrite_storage_textures`, which the engine asks of every
 * browser before it starts (`WEBGPU_REQUIRED_WGSL_FEATURES`) —: its nodes (`treeWord`,
 * `treeSetWord`), indexed within the tree, and its order (`treeMember`); and the frame words, read
 * (`frameTable.ts`): each placement's root. Group 1 binds the pass's own:
 *
 *   params      uniform        the level's first id, how many, and what it fits (below)
 *   ids         array<u32>     the nodes of the level to fit, as their index within it
 *   members     array<vec2u>   each placement's leaf box, six doubles
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { dAbs, dAdd, dLess, dMax, dMin, dMul, dSub } from '../../../../math/src/wgsl/double.ts'
import { fromF32, toF32 } from '../../../../math/src/wgsl/f32.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../dispatch/grid.ts'
import { treeTableWgsl } from './treeTable.ts'
import { frameTableWgsl } from './frameTable.ts'
import { MARGIN, TREE_SPAN } from './placementTree.ts'
import { NODE_MAX, NODE_MIN } from './nodeLayout.ts'
import { FINITE_SENTINEL } from '../../../../math/src/wgsl/constants.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** Where a placement's root lies in its frame row (`primitiveFrameWords`). */
const FRAME_ROOT = 1
/** What the shader reads a level's parameters as: words of `Params`. */
export const REFIT_PARAM_WORDS = 8

/** The margin as the shaders hold a double, high word then low (`packDoubles`). */
const margin = new Uint32Array(2)
packDoubles(margin, 0, [MARGIN])

/** The node `n` written from the doubles `lo` and `hi`: the empty box when they cross, else as
 *  fitted. */
const WRITE_BOX_WGSL = wgslBlock(
  'WRITE_BOX_WGSL',
  [dAdd, dSub, dMul, dLess, dMax, dAbs, toF32, FINITE_SENTINEL],
  `
fn writeBox(n:u32,lo:array<vec2u,3>,hi:array<vec2u,3>){
 if(dLess(hi[0],lo[0])||dLess(hi[1],lo[1])||dLess(hi[2],lo[2])){
  let low=bitcast<u32>(FINITE_SENTINEL);
  let high=bitcast<u32>(-FINITE_SENTINEL);
  for(var a=0u;a<3u;a++){treeSetWord(n,${NODE_MIN}u+a,low);treeSetWord(n,${NODE_MAX}u+a,high);}
  return;
 }
 var reach=vec2u(0u,0u);
 for(var a=0u;a<3u;a++){
  reach=dMax(reach,dMax(dAbs(lo[a]),dAbs(hi[a])));
  reach=dMax(reach,dSub(hi[a],lo[a]));
 }
 let grown=dMul(reach,vec2u(${margin[0]}u,${margin[1]}u));
 for(var a=0u;a<3u;a++){
  treeSetWord(n,${NODE_MIN}u+a,toF32(dSub(lo[a],grown)));
  treeSetWord(n,${NODE_MAX}u+a,toF32(dAdd(hi[a],grown)));
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
 for(var k=0u;k<gm;k++){
  let w=treeMember(first+k);
  if(w==${NO_INDEX}u){continue;}
  if(framesWord(w,${FRAME_ROOT}u)==${NO_INDEX}u){continue;}
  for(var a=0u;a<3u;a++){
   lo[a]=dMin(lo[a],members[w*6u+a]);
   hi[a]=dMax(hi[a],members[w*6u+3u+a]);
  }
 }
 writeBox(params.base+j,lo,hi);
}
fn fitCell(j:u32){
 let first=j*${TREE_SPAN}u;
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){lo[a]=vec2u(0x7ff00000u,0u);hi[a]=vec2u(0xfff00000u,0u);}
 let end=min(first+${TREE_SPAN}u,params.childCount);
 for(var c=first;c<end;c++){
  let child=params.childBase+c;
  for(var a=0u;a<3u;a++){
   lo[a]=dMin(lo[a],fromF32(treeWord(child,${NODE_MIN}u+a)));
   hi[a]=dMax(hi[a],fromF32(treeWord(child,${NODE_MAX}u+a)));
  }
 }
 writeBox(params.base+j,lo,hi);
}`,
)

/**
 * One thread per node of a level: the group or the cell `ids` names, fitted. Its dispatches run
 * bottom up in one pass: the level above reads the boxes the one below wrote.
 */
export const TREE_REFIT_WGSL = wgslProgram(
  `struct Params{first:u32,count:u32,base:u32,live:u32,childBase:u32,childCount:u32,cells:u32,pad:u32,}
@group(1) @binding(0) var<uniform> params:Params;
@group(1) @binding(1) var<storage,read> ids:array<u32>;
@group(1) @binding(2) var<storage,read> members:array<vec2u>;
@compute @workgroup_size(WORKGROUP_THREADS) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g,n,WORKGROUP_THREADS);if(i>=params.count){return;}
 let j=ids[params.first+i];
 if(params.cells==0u){fitGroup(j);}else{fitCell(j);}
}`,
  [
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    FIT_WGSL,
    treeTableWgsl('tree', { group: 0, binding: 0, access: 'read_write' }),
    frameTableWgsl('frames', { group: 0, binding: 1, access: 'read' }),
  ],
)
