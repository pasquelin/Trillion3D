/**
 * THE ROOT BOXES PASS (`rootBoxes.ts`): a thread a root whose world moved — one the host moved,
 * whose world the CPU sent (`rootWorlds.ts`), or one a parent composes, whose world the compose
 * worlds pass wrote —, reading its world where every pass reads it, the roots' double worlds. It
 * writes the two things a root's world decides of the root itself (`composeRoot`): its world box,
 * its local box carried by that world, and its stretch, solved once a root: both beside the box,
 * where its rows' detail reads them (`composeLod`), the stretch also in the stretch field of the
 * cut's frame words (`stretchBits`), which every cut projects its errors through. The one writer of
 * both on the GPU: no CPU box, no CPU stretch at a move, and a row the host sends again never takes
 * the stretch back (`../gpu/dag/frameTable.ts`).
 *
 *   params      uniform        the roots, the roots listed, and whether every root is (`whole`:
 *                              thread `j` is root `j`)
 *   rootWorlds  array<vec2u>   sixteen doubles a root
 *   rootInputs  array<vec2u>   seven doubles a root: its local box, then whether it has one
 *   rootBoxes   array<vec2u>   seven doubles a root: its world box, zero when it has no box, then
 *                              its stretch
 *   ranks       array<u32>     the roots listed
 *   frames      r32uint        the cut's frame words, written alone (`../gpu/dag/frameTable.ts`):
 *                              a root's stretch, its own field
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { frameTableWgsl } from '../gpu/dag/frameTable.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { WORLD_BOX_WGSL } from './gpuComposeDerivedWgsl.ts'
import { STRETCH_WGSL } from './gpuStretchWgsl.ts'

/** The pass's entry point. */
export const ROOT_BOXES_ENTRY = 'deriveRootBoxes'
/** The binding of the cut's frame words: a write-only storage texture (`frameTableWgsl`). */
export const ROOT_BOXES_FRAMES_BINDING = 5

export const ROOT_BOXES_WGSL = wgslProgram(
  `struct Params{rootCount:u32,listed:u32,whole:u32,pad:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> rootWorlds:array<vec2u>;
@group(0) @binding(2) var<storage,read> rootInputs:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> rootBoxes:array<vec2u>;
@group(0) @binding(4) var<storage,read> ranks:array<u32>;
fn deriveRoot(rank:u32){
 var world:array<vec2u,${MATRIX_VALUES}>;
 for(var k=0u;k<${MATRIX_VALUES}u;k++){world[k]=rootWorlds[rank*${MATRIX_VALUES}u+k];}
 let stretch=stretchBits(world,composeRoot(rank,world));
 if(stretch!=0xffffffffu){framesSetStretch(rank,stretch);}
}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${ROOT_BOXES_ENTRY}(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,WORKGROUP_THREADS);if(j>=params.listed){return;}
 var rank=j;
 if(params.whole==0u){rank=ranks[j];}
 if(rank>=params.rootCount){return;}
 deriveRoot(rank);
}`,
  [
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    WORLD_BOX_WGSL,
    STRETCH_WGSL,
    frameTableWgsl('frames', { group: 0, binding: ROOT_BOXES_FRAMES_BINDING, access: 'write' }),
  ],
)
