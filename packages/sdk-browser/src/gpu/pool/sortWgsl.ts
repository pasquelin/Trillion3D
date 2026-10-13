import { POOL_RANKS_WGSL, POOL_RANK_WGSL } from './rankWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL } from '../dispatch/grid.ts'

/**
 * THE VICTIM QUEUE of a GPU pool (#1527): a counting sort of the pool's slots by `poolRank`
 * (`rankWgsl.ts`), the highest ranks first, at most a burst, in three dispatches (`sort.ts`):
 *
 * - `poolCount`, a thread a slot: each workgroup counts its slots' ranks in workgroup memory, then
 *   adds each count it holds to the pool's global counter of that rank once;
 * - `poolPlace`, one thread: each rank's first place, from the highest rank down, the counters
 *   zeroed for the next sort, and the total handed to the host (`poolPlaced`);
 * - `poolScatter`, a thread a slot: each slot ranked takes the next place of its rank, and a
 *   place under the burst names it (`poolEmit`).
 *
 * The sort scales over workgroups: no lane walks more than its slot, whatever the pool. Within a
 * rank the order is the threads': the rank alone orders.
 *
 * The program that holds it declares, over its own bindings: `poolSlotCount()`, the slots swept;
 * `poolSlotAge(j)`, `poolSlotTier(j)` and `poolInUse()`, what `poolRank` reads; `poolBurst()`;
 * `poolCountAdd(i, v)`, `poolCountLoad(i)` and `poolCountStore(i, v)` over `2 × POOL_RANKS` atomic
 * words zeroed at creation — the counts, then the places —; `poolPlaced(total)`; `poolEmit(at, j)`.
 */
export const POOL_SORT_WGSL = wgslBlock(
  'POOL_SORT_WGSL',
  [POOL_RANKS_WGSL, POOL_RANK_WGSL, FLAT_INDEX_WGSL],
  `const POOL_LANES:u32=256u;
var<workgroup> poolLocal:array<atomic<u32>,POOL_RANKS>;
/** Slot \`j\`'s rank, \`POOL_RANKS\` past the slots or in use. */
fn poolSlotRank(j:u32)->u32{
 if(j>=poolSlotCount()){return POOL_RANKS;}
 return poolRank(poolSlotAge(j),poolSlotTier(j),poolInUse());
}
@compute @workgroup_size(POOL_LANES)
fn poolCount(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let rank=poolSlotRank(flatIndex(id,n,POOL_LANES));
 if(rank<POOL_RANKS){atomicAdd(&poolLocal[rank],1u);}
 workgroupBarrier();
 for(var r=lane;r<POOL_RANKS;r+=POOL_LANES){let c=atomicLoad(&poolLocal[r]);if(c>0u){poolCountAdd(r,c);}}
}
@compute @workgroup_size(1)
fn poolPlace(){
 var place=0u;
 for(var r=POOL_RANKS;r>0u;r--){let c=poolCountLoad(r-1u);poolCountStore(r-1u,0u);poolCountStore(POOL_RANKS+r-1u,place);place+=c;}
 poolPlaced(place);
}
@compute @workgroup_size(POOL_LANES)
fn poolScatter(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(id,n,POOL_LANES);let rank=poolSlotRank(j);
 if(rank>=POOL_RANKS||poolCountLoad(POOL_RANKS+rank)>=poolBurst()){return;}
 let at=poolCountAdd(POOL_RANKS+rank,1u);
 if(at<poolBurst()){poolEmit(at,j);}
}
`,
)
