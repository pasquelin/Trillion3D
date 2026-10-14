import {
  STATE_TALLY_WGSL,
  ST_REJECTED,
  ST_REJECTED_TRIANGLES,
  ST_TESTED,
  VERDICT_KEPT,
  VERDICT_REJECTED,
} from '../partition/contract.ts'
import { HIZ_HIDES_WGSL } from './rectWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { FLAT_INDEX_WGSL, GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL } from '../dispatch/grid.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The occlusion test of the depth pyramid (`shader.ts`, `HIZ_SHADER`): its group 1 — the page table
 * and the test's dispatch arguments (`bindEntries.ts`) — and its kernels, which read the host's
 * boxes, verdict flags, state and uniform, and its culling layer (`hizCullFarthest`).
 */
export const HIZ_TEST_WGSL = wgslBlock(
  'HIZ_TEST_WGSL',
  [
    PAGE_INFO_STRUCT_WGSL,
    FLAT_INDEX_WGSL,
    GROUP_GRID_WGSL,
    WORKGROUP_THREADS_WGSL,
    NO_INDEX,
    ceilDivWgsl,
    STATE_TALLY_WGSL,
    HIZ_HIDES_WGSL,
  ],
  `@group(1) @binding(0) var<storage, read> pages:array<PageInfo>;
@group(1) @binding(1) var<storage, read_write> testArgs:array<u32>;
// Only boxes the frame tests travel this far, each carrying the verdict row it answers for;
// every other drawable row holds the verdict the partition wrote this frame (\`classifyRows\`).
// The box count is the one the partition compacted: the CPU does not know it, \`testHizArgs\`
// sizes the dispatch by it.
// Its reject counters, on a sampled frame only (\`uni.counting\`, \`STATE_TALLY_WGSL\`).
@compute @workgroup_size(WORKGROUP_THREADS)
fn testHiz(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(id,n,WORKGROUP_THREADS);
 if(i<atomicLoad(&state[${ST_TESTED}u])){testBox(i);}
 flushTally(lane);
}
/** The test's indirect arguments: one workgroup of threads per \`WORKGROUP_THREADS\` compacted boxes, in rows. */
@compute @workgroup_size(1)
fn testHizArgs(){
 let g=groupGrid(ceilDiv(atomicLoad(&state[${ST_TESTED}u]),WORKGROUP_THREADS));
 testArgs[0]=g.x;testArgs[1]=g.y;testArgs[2]=1u;
}
fn testBox(i:u32){
 let b=bounds[i];
 let row=b.rowAndClip>>1u;
 // A tested row the pyramid cannot judge stays drawn: kept, never an occluder — the compute
 // raster draws occluders in its other mode. A row with no verdict slot (never culled) is not
 // judged either: no reject is counted for a row that draws.
 if(pages[row].hizSlot==NO_INDEX||(b.rowAndClip&1u)!=0u||b.maxX<b.minX||b.maxY<b.minY){flags[row]=${VERDICT_KEPT}u;return;}
 // Reverse-Z: a box is rejected when its NEAREST point stays behind the pyramid's farthest,
 // hence when it is SMALLER. The coarse mip the partition packed is read first (\`pyramidHides\`).
 let reject=select(0u,1u,pyramidHides(b.minX,b.minY,b.maxX,b.maxY,b.fineOffset,b.fineWidth,b.nearest,b.coarseOffset,b.coarseWidth,b.coarseShift));
 flags[row]=select(${VERDICT_KEPT}u,${VERDICT_REJECTED}u,reject!=0u);
 if(reject!=0u){
  tallyAdd(${ST_REJECTED}u,1u);
  tallyAdd(${ST_REJECTED_TRIANGLES}u,b.triangles);
 }
}`,
)
