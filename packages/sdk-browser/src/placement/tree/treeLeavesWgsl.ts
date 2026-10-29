/**
 * THE PLACEMENT TREE'S LEAVES (`treeLeaves.ts`): the leaf boxes the tree's refit fits over
 * (`../../geometry/dag/tree/treeRefit.ts`), one writer for every placement — one the host moved, one a parent
 * composes, one marked, parked or taken back, one appended. A placement's leaf is the box of its
 * root node, as the packing holds it, grown first in its own space by its deformation's reach (the
 * half its mark carries, none past every finite one), carried by its world as the GPU holds it —
 * the roots' double worlds, which no pass composes again —, six doubles in `members`.
 * A parked placement, its root none, keeps the leaf it had: the refit passes over it. Beside the
 * box, an instance of an assembly's leaf holds the group above its root as the world holds it
 * (`PARENT_LEAF`): the centre of its ball carried by the world, its radius by the world's largest
 * axis scale and its error by the smallest — as the cut scales them (`placedScale`) —, both grown
 * past the rounding, and a one in the last word; zeros for any other placement. A cut whose
 * packing names no group above any root holds the box alone: the kernel is made with the stride
 * `PARENT_LEAF` (`LEAF_STRIDE`, `leafStride`) and writes no ball.
 *
 *   params   uniform        the roots, the placements listed, and whether every one is
 *                           (`whole`: thread `j` is placement `j`)
 *   worlds   array<vec2u>   sixteen doubles a placement
 *   members  array<vec2u>   the leaves, `LEAF_STRIDE` doubles a placement
 *   ranks    array<u32>     the placements listed
 *   frames   r32uint        the cut's frame words (`../../geometry/dag/frameTable.ts`): the root, the
 *                           mark, the node of the parent (`PARENT_WORD`)
 *   nodes    rgba32uint     the cut's nodes (`../../geometry/dag/nodeTable.ts`): the root's box, the
 *                           parent's ball and error
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { BOX_VALUES } from '../../../../math/src/geometry/box.ts'
import { affineAxis } from '../../../../math/src/wgsl/doubleAffine.ts'
import {
  LEAF_DOUBLES,
  LEAF_STRIDE_CONSTANT,
  MARGIN,
  PARENT_LEAF,
  PARENT_MARGIN,
} from '../../geometry/dag/placement/placementTree.ts'
import { CARRIED_BOX_WGSL } from '../compose/gpuComposeDerivedWgsl.ts'
import { NODE_MAX, NODE_MIN, PARENT_ERROR, PARENT_SPHERE } from '../../geometry/dag/nodeLayout.ts'
import { markReachWgsl, reachUnboundedWgsl } from '../../deformation/halfFloat.ts'
import { nodeTableWgsl } from '../../geometry/dag/nodeTable.ts'
import { dAdd, dSub } from '../../../../math/src/wgsl/double.ts'
import { LISTED_ROOTS_WGSL } from '../roots/listedRootsWgsl.ts'
import {
  frameTableWgsl,
  MARK_WORD,
  PARENT_WORD,
  ROOT_PARENT_MARK,
  ROOT_WORD,
} from '../../geometry/dag/frameTable.ts'
import { doubleAsSingle, fromF32 } from '../../../../math/src/wgsl/f32.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** The bindings of the cut's frame words and of its nodes, read (`frameTableWgsl`,
 *  `nodeTableWgsl`). */
export const TREE_LEAVES_FRAMES_BINDING = 4,
  TREE_LEAVES_NODES_BINDING = 5

/** The pass's text: one thread a placement, each writing its leaf (`writeLeaf`). */
export const TREE_LEAVES_WGSL = wgslProgram(
  `override ${LEAF_STRIDE_CONSTANT}:u32=${LEAF_DOUBLES}u;
@group(0) @binding(1) var<storage,read> worlds:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> members:array<vec2u>;
@group(0) @binding(3) var<storage,read> ranks:array<u32>;
/** Placement \`w\`'s parent leaf (\`PARENT_LEAF\`) at \`world\`: the ball of the group above its root
 *  carried by the world, its radius by the largest axis scale, its error by the smallest, grown by
 *  the margins; zeros — and no one — when its mark names none or a number is not finite. */
fn writeParentLeaf(w:u32,world:array<vec2u,16>,mark:u32){
 let at=w*${LEAF_STRIDE_CONSTANT}+${PARENT_LEAF}u;
 var cx=0.0;var cy=0.0;var cz=0.0;var radius=0.0;var err=0.0;var named=0u;
 if((mark&${ROOT_PARENT_MARK}u)!=0u){
  let record=framesWord(w,${PARENT_WORD}u);
  let ball=bitcast<vec4f>(nodesNode(record,${PARENT_SPHERE >> 2}u));
  let x=fromF32(bitcast<u32>(ball.x));let y=fromF32(bitcast<u32>(ball.y));let z=fromF32(bitcast<u32>(ball.z));
  let c=vec3f(doubleAsSingle(affineAxis(world,0u,x,y,z)),doubleAsSingle(affineAxis(world,1u,x,y,z)),doubleAsSingle(affineAxis(world,2u,x,y,z)));
  let la=length(vec3f(doubleAsSingle(world[0]),doubleAsSingle(world[1]),doubleAsSingle(world[2])));
  let lb=length(vec3f(doubleAsSingle(world[4]),doubleAsSingle(world[5]),doubleAsSingle(world[6])));
  let lc=length(vec3f(doubleAsSingle(world[8]),doubleAsSingle(world[9]),doubleAsSingle(world[10])));
  let most=max(la,max(lb,lc));let least=min(la,min(lb,lc));
  let grown=ball.w*most;
  let reach=max(max(abs(c.x),abs(c.y)),abs(c.z))+grown;
  let r=grown+${MARGIN}*reach;
  let e=bitcast<f32>(nodesWord(record,${PARENT_ERROR}u))*least*(1.0+${PARENT_MARGIN});
  if(r>=0.0&&r<3.0e38&&e>=0.0&&e<3.0e38&&reach<3.0e38){cx=c.x;cy=c.y;cz=c.z;radius=r;err=e;named=1u;}
 }
 members[at]=vec2u(bitcast<u32>(cx),bitcast<u32>(cy));
 members[at+1u]=vec2u(bitcast<u32>(cz),bitcast<u32>(radius));
 members[at+2u]=vec2u(bitcast<u32>(err),named);
}
fn writeLeaf(w:u32){
 let root=framesWord(w,${ROOT_WORD}u);
 if(root==${NO_INDEX}u){return;}
 var world:array<vec2u,${MATRIX_VALUES}>;
 for(var k=0u;k<${MATRIX_VALUES}u;k++){world[k]=worlds[w*${MATRIX_VALUES}u+k];}
 // The reach its mark carries (its frame row's mark word), none past every finite one.
 let mark=framesWord(w,${MARK_WORD}u);
 var reach=vec2u(0u,0u);
 if(!reachUnbounded(mark)){reach=fromF32(bitcast<u32>(markReach(mark)));}
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){
  lo[a]=dSub(fromF32(nodesWord(root,${NODE_MIN}u+a)),reach);
  hi[a]=dAdd(fromF32(nodesWord(root,${NODE_MAX}u+a)),reach);
 }
 let box=carriedBox(world,lo,hi);
 for(var k=0u;k<${BOX_VALUES}u;k++){members[w*${LEAF_STRIDE_CONSTANT}+k]=box[k];}
 if(${LEAF_STRIDE_CONSTANT}>${PARENT_LEAF}u){writeParentLeaf(w,world,mark);}
}
@compute @workgroup_size(WORKGROUP_THREADS) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let w=listedRank(g,n);
 if(w!=NO_INDEX){writeLeaf(w);}
}`,
  [
    LISTED_ROOTS_WGSL,
    fromF32,
    doubleAsSingle,
    affineAxis,
    markReachWgsl,
    reachUnboundedWgsl,
    dAdd,
    dSub,
    CARRIED_BOX_WGSL,
    nodeTableWgsl('nodes', { group: 0, binding: TREE_LEAVES_NODES_BINDING }),
    frameTableWgsl('frames', { group: 0, binding: TREE_LEAVES_FRAMES_BINDING, access: 'read' }),
  ],
)
