/**
 * The members pass of the composition (`gpuCompose.ts`, `composedLeaves`): the leaf boxes the
 * placement tree's refit fits over (`../gpu/dag/treeRefit.ts`) for the roots a parent composes. It
 * runs in the refit's command buffer, before the frame's: it composes `parent · local` itself
 * (`PRODUCT_WGSL`), the frame's worlds pass not having run yet.
 */
import { CARRIED_BOX_WGSL } from './gpuComposeDerivedWgsl.ts'
import { NODE_MAX, NODE_MIN } from '../gpu/dag/nodeLayout.ts'
import { REACH_UNBOUNDED } from '../gpu/dag/placementTree.ts'
import { nodeTableBlock, WHOLE_LAYOUT, type RefitLayout } from '../gpu/dag/treeRefitWgsl.ts'
import { dAdd, dSub } from '../../../math/src/wgsl/double.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { FRAME_ROW_WORDS } from '../gpu/dag/types.ts'
import { fromF32 } from '../../../math/src/wgsl/f32.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { MATRIX_DOUBLES, NONE, PRODUCT_WGSL } from './gpuComposeWgsl.ts'

/**
 * One thread per root a parent composes (`ranks`), those of a range at work: the leaf box the
 * placement tree fits over (`treeRefit.ts`) of a
 * root a parent composes — the box of its root node, as the packing holds it, carried by the
 * composed world, grown first in its own space by its deformation's reach (`leafReach`) — in the
 * table of leaf boxes, six doubles a placement, as `memberBox` writes it for a root whose world the
 * CPU holds. A root without a parent, or parked (its root node none), keeps the box it had.
 */
export const composeMembersWgsl = (nodes: RefitLayout['nodes'] = WHOLE_LAYOUT.nodes) =>
  wgslProgram(
    `struct Params{rootCount:u32,first:u32,count:u32,listed:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> locals:array<vec2u>;
@group(0) @binding(2) var<storage,read> parentOf:array<u32>;
@group(0) @binding(3) var<storage,read> parents:array<vec2u>;
@group(0) @binding(4) var<storage,read> frames:array<u32>;
@group(0) @binding(5) var<storage,read_write> members:array<vec2u>;
@group(0) @binding(6) var<storage,read> ranks:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,64u);if(j>=params.listed){return;}
 let rank=ranks[j];
 if(rank<params.first||rank>=params.first+params.count||rank>=params.rootCount){return;}
 let i=rank-params.first;
 let p=parentOf[rank];
 if(p==${NONE}u){return;}
 let root=frames[i*${FRAME_ROW_WORDS}u+1u];
 if(root==${NONE}u){return;}
 var world:array<vec2u,16>;
 for(var k=0u;k<16u;k++){world[k]=composed(p*${MATRIX_DOUBLES}u,rank*${MATRIX_DOUBLES}u,k);}
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
 for(var k=0u;k<6u;k++){members[rank*6u+k]=box[k];}
}`,
    [
      PRODUCT_WGSL,
      FLAT_INDEX_WGSL,
      fromF32,
      dAdd,
      dSub,
      CARRIED_BOX_WGSL,
      nodeTableBlock(nodes, 1, false),
    ],
  )
