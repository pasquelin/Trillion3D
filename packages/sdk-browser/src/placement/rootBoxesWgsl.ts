/**
 * THE ROOT BOXES PASS (`rootBoxes.ts`): a thread a root whose world moved — one the host moved,
 * whose world the CPU sent (`rootWorlds.ts`), or one a parent composes, whose world the compose
 * worlds pass wrote —, reading its world where every pass reads it, the roots' double worlds. It
 * writes the two things a root's world decides of the root itself: its world box, its local box
 * carried by that world (`composeBox`), which its rows' detail reads the radius of its object from,
 * and its stretch (`maxStretchBits`), in its row of the cut's frame words, which every cut projects
 * its errors through. The one writer of both on the GPU: no CPU box, no CPU stretch at a move.
 *
 *   params      uniform        the roots, the roots listed, and whether every root is (`whole`:
 *                              thread `j` is root `j`)
 *   rootWorlds  array<vec2u>   sixteen doubles a root
 *   rootInputs  array<vec2u>   seven doubles a root: its local box, then whether it has one
 *   rootBoxes   array<vec2u>   six doubles a root, its world box, none when it has no box
 *   ranks       array<u32>     the roots listed
 *   frames      r32uint        the cut's frame words, written alone (`../gpu/dag/frameTable.ts`):
 *                              the stretch, the first word of a root's row
 */
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
 var world:array<vec2u,16>;
 for(var k=0u;k<16u;k++){world[k]=rootWorlds[rank*16u+k];}
 if(rootInputs[rank*7u+6u].x!=0u){composeBox(rank,rank*7u,world);}
 else{for(var k=0u;k<6u;k++){rootBoxes[rank*6u+k]=vec2u(0u,0u);}}
 let stretch=maxStretchBits(world);
 if(stretch!=0xffffffffu){framesSetWord(rank,0u,stretch);}
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
