/**
 * THE PLACEMENT TREE'S LEAVES (`treeLeaves.ts`): the leaf boxes the tree's refit fits over
 * (`../gpu/dag/treeRefit.ts`), one writer for every placement — one the host moved, one a parent
 * composes, one marked, parked or taken back, one appended. A placement's leaf is the box of its
 * root node, as the packing holds it, grown first in its own space by its deformation's reach (the
 * half its mark carries, none past every finite one), carried by its world as the GPU holds it —
 * the roots' double worlds, which no pass composes again —, six doubles a placement in `members`.
 * A parked placement, its root none, keeps the leaf it had: the refit passes over it.
 *
 *   params   uniform        the roots, the range of the cut's worlds at work, the placements
 *                           listed, and whether every one is (`whole`: thread `j` is placement `j`)
 *   worlds   array<vec2u>   sixteen doubles a placement
 *   frames   array<u32>     the range's frame words: the root (`+ 1`), the mark (`+ 3`)
 *   members  array<vec2u>   the leaves
 *   ranks    array<u32>     the placements listed
 */
import { CARRIED_BOX_WGSL } from './gpuComposeDerivedWgsl.ts'
import { NODE_MAX, NODE_MIN } from '../gpu/dag/nodeLayout.ts'
import { REACH_UNBOUNDED } from '../gpu/dag/placementTree.ts'
import { nodeTableBlock, WHOLE_NODES, type NodeTableLayout } from '../gpu/dag/nodeTableWgsl.ts'
import { dAdd, dSub } from '../../../math/src/wgsl/double.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { FRAME_ROW_WORDS } from '../gpu/dag/types.ts'
import { fromF32 } from '../../../math/src/wgsl/f32.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'

/** The pass's text for a layout of the tree's nodes (`nodeTableBlock`): one thread a placement,
 *  each writing its leaf (`writeLeaf`, placement `w` at row `i` of its range's frames). */
export const treeLeavesWgsl = (nodes: NodeTableLayout = WHOLE_NODES) =>
  wgslProgram(
    `struct Params{rootCount:u32,first:u32,count:u32,listed:u32,whole:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> worlds:array<vec2u>;
@group(0) @binding(2) var<storage,read> frames:array<u32>;
@group(0) @binding(3) var<storage,read_write> members:array<vec2u>;
@group(0) @binding(4) var<storage,read> ranks:array<u32>;
fn writeLeaf(w:u32,i:u32){
 let root=frames[i*${FRAME_ROW_WORDS}u+1u];
 if(root==${NO_INDEX}u){return;}
 var world:array<vec2u,16>;
 for(var k=0u;k<16u;k++){world[k]=worlds[w*16u+k];}
 // The reach its mark carries (the frame row's word 3), none past every finite one.
 let mark=frames[i*${FRAME_ROW_WORDS}u+3u];
 var reach=vec2u(0u,0u);
 if((mark>>16u)<${REACH_UNBOUNDED}u){reach=fromF32(bitcast<u32>(unpack2x16float(mark).y));}
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){
  lo[a]=dSub(fromF32(nodeWord(root,${NODE_MIN}u+a)),reach);
  hi[a]=dAdd(fromF32(nodeWord(root,${NODE_MAX}u+a)),reach);
 }
 let box=carriedBox(world,lo,hi);
 for(var k=0u;k<6u;k++){members[w*6u+k]=box[k];}
}
@compute @workgroup_size(WORKGROUP_THREADS) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,WORKGROUP_THREADS);if(j>=params.listed){return;}
 var w=j;
 if(params.whole==0u){w=ranks[j];}
 if(w<params.first||w>=params.first+params.count||w>=params.rootCount){return;}
 writeLeaf(w,w-params.first);
}`,
    [
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      fromF32,
      dAdd,
      dSub,
      CARRIED_BOX_WGSL,
      nodeTableBlock(nodes, 1),
    ],
  )
