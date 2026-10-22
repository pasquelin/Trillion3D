/**
 * THE PLACEMENT TREE REFIT, in the shader (`treeRefit.ts`): the boxes of the nodes a change touched,
 * bottom up. A group's box is the union of its members' leaf boxes — doubles, `members` six a
 * placement, the GPU's (`../../../placement/tree/treeLeavesWgsl.ts`) —, a cell's the union of its children's
 * boxes as the nodes hold them; both grown by `MARGIN` of the farthest coordinate and the widest
 * side, then stored as single precision. Every box is finite: a member's leaf holds its
 * deformation's reach, and one drawn whatever the view is opened from queue 0, never by its group
 * (`../placement/placementTree.ts`). A parked member, or a
 * slot no placement holds, holds nothing; a node that holds nothing takes the empty box, its bounds
 * crossed at the finite sentinel (`FINITE_SENTINEL`), which every union passes over.
 *
 * With its box a group takes the draw distances of its placements (`TREE_DRAW_NEAR`,
 * `TREE_DRAW_FAR`), read in their frame words: the nearest and the farthest of those they name,
 * both 0 when a member is drawn at every distance or it holds none (`shader/drawDistanceWgsl.ts`).
 * A cell holds none.
 *
 * Group 0 binds the tree's record table (`treeTable.ts`) as a storage texture read and written in
 * place — the WGSL feature `readonly_and_readwrite_storage_textures`, which the engine asks of every
 * browser before it starts (`WEBGPU_REQUIRED_WGSL_FEATURES`) —: its nodes (`treeWord`,
 * `treeSetWord`), indexed within the tree, and its order (`treeMember`); and the frame words, read
 * (`../frameTable.ts`): each placement's root. Group 1 binds the pass's own:
 *
 *   params      uniform        the level's first id, how many, and what it fits (below)
 *   ids         array<u32>     the nodes of the level to fit, as their index within it
 *   members     array<vec2u>   each placement's leaf box, six doubles
 */
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { dAbs, dAdd, dLess, dMax, dMin, dMul, dSub } from '../../../../../math/src/wgsl/double.ts'
import { fromF32, toF32 } from '../../../../../math/src/wgsl/f32.ts'
import { D_INFINITY, D_NEG_INFINITY, D_ZERO } from '../../../../../math/src/wgsl/doubleConstants.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { treeTableWgsl } from './treeTable.ts'
import { DRAW_FAR_WORD, DRAW_NEAR_WORD, frameTableWgsl, ROOT_WORD } from '../frameTable.ts'
import { MARGIN, TREE_SPAN } from '../placement/placementTree.ts'
import { NODE_MAX, NODE_MIN, TREE_DRAW_FAR, TREE_DRAW_NEAR } from '../nodeLayout.ts'
import { FINITE_SENTINEL } from '../../../../../math/src/wgsl/constants.ts'
import { f64WordsInto } from '../../../../../math/src/float/bits.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'

/** What the shader reads a level's parameters as: words of `Params`. */
export const REFIT_PARAM_WORDS = 8

/** The margin as the shaders hold a double, high word then low (`f64WordsInto`). */
const margin = new Uint32Array(2)
f64WordsInto(margin, 0, MARGIN)

/** The node `n` written from the doubles `lo` and `hi`: the empty box when they cross, else as
 *  fitted. */
const WRITE_BOX_WGSL = wgslBlock(
  'WRITE_BOX_WGSL',
  [dAdd, dSub, dMul, dLess, dMax, dAbs, toF32, FINITE_SENTINEL, D_ZERO],
  `
fn writeBox(n:u32,lo:array<vec2u,3>,hi:array<vec2u,3>){
 if(dLess(hi[0],lo[0])||dLess(hi[1],lo[1])||dLess(hi[2],lo[2])){
  let low=bitcast<u32>(FINITE_SENTINEL);
  let high=bitcast<u32>(-FINITE_SENTINEL);
  for(var a=0u;a<3u;a++){treeSetWord(n,${NODE_MIN}u+a,low);treeSetWord(n,${NODE_MAX}u+a,high);}
  return;
 }
 var reach=D_ZERO;
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
  [WRITE_BOX_WGSL, fromF32, dMin, dMax, D_INFINITY, D_NEG_INFINITY, FINITE_SENTINEL],
  `
fn fitGroup(j:u32){
 let first=j*${TREE_SPAN}u;
 var gm=0u;
 if(params.live>first){gm=min(params.live-first,${TREE_SPAN}u);}
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 // The nearest of the nearest distances, the farthest of the farthest, from the identity elements
 // of the two; a placement that names none is (0, FINITE_SENTINEL): both leave it.
 var found=vec2f(FINITE_SENTINEL,0.0);
 for(var a=0u;a<3u;a++){lo[a]=D_INFINITY;hi[a]=D_NEG_INFINITY;}
 for(var k=0u;k<gm;k++){
  let w=treeMember(first+k);
  if(w==${NO_INDEX}u){continue;}
  if(framesWord(w,${ROOT_WORD}u)==${NO_INDEX}u){continue;}
  for(var a=0u;a<3u;a++){
   lo[a]=dMin(lo[a],members[w*6u+a]);
   hi[a]=dMax(hi[a],members[w*6u+3u+a]);
  }
  let far=bitcast<f32>(framesWord(w,${DRAW_FAR_WORD}u));
  if(far>0.0){found=vec2f(min(found.x,bitcast<f32>(framesWord(w,${DRAW_NEAR_WORD}u))),max(found.y,far));}
  else{found=vec2f(0.0,FINITE_SENTINEL);}
 }
 writeBox(params.base+j,lo,hi);
 let named=found.y>0.0&&found.y<FINITE_SENTINEL;
 treeSetWord(params.base+j,${TREE_DRAW_NEAR}u,bitcast<u32>(select(0.0,found.x,named)));
 treeSetWord(params.base+j,${TREE_DRAW_FAR}u,bitcast<u32>(select(0.0,found.y,named)));
}
fn fitCell(j:u32){
 let first=j*${TREE_SPAN}u;
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){lo[a]=D_INFINITY;hi[a]=D_NEG_INFINITY;}
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
