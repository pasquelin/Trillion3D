import { POOL_RANKS_WGSL, POOL_RANK_WGSL } from './rankWgsl.ts'
import { POOL_LANES_WGSL, POOL_SORT_HEAD_WGSL } from './sort.ts'
import { POOL_SORT_STABLE_WGSL } from './sortStableWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL } from '../dispatch/grid.ts'
import { LANE_SCAN_WGSL } from '../core/laneScanWgsl.ts'

/**
 * THE VICTIM QUEUE of a GPU pool (#1527): a stable counting sort of the pool's slots by `poolRank`
 * (`rankWgsl.ts`), the highest ranks first and, within a rank, the lower slot first — whatever
 * order the threads run in, two runs over the same slots give the same queue —, at most a burst,
 * in six dispatches (`sort.ts`; `sort.fixture.ts` its contract):
 *
 * - `poolCount`, a thread a slot: each workgroup counts its slots' ranks in workgroup memory, then
 *   adds each count it holds to the pool's global counter of that rank once;
 * - `poolPlace`, one workgroup: each lane sums its run of ranks, from the highest down, the lane
 *   scan (`LANE_SCAN_WGSL`) gives each run its first place, each lane hands its ranks their first
 *   places, the counters zeroed for the next sort, and marks the BOUNDARY rank, the one whose
 *   places hold the burst's last; the last lane hands the total to the host (`poolPlaced`);
 * - `poolGroups`, a workgroup of `WORKGROUP_THREADS` lanes per `POOL_LANES` slots: how many of its
 *   slots rank above the boundary — every one listed — and how many at it — the first ones listed;
 * - `poolOffsets`, one workgroup: each group's first index of either kind, the groups in slot
 *   order (the lane scan);
 * - `poolSpread`, as `poolGroups`: each slot above the boundary STAGED at its index in slot
 *   order, each slot at the boundary listed at the boundary's place plus its index, under the
 *   burst;
 * - `poolScatter`, one workgroup: the staged slots, fewer than a burst, walked in slot order a
 *   workgroup at a time, each listed at its rank's next place.
 *
 * No atomic decides a place: every count is a sum, every index a scan in slot order. No lane walks
 * more than its slot, its run of ranks or of groups, or a burst.
 *
 * The program that holds it declares, over its own bindings: `poolSlotCount()`, the slots swept;
 * `poolSlotAge(j)`, `poolSlotTier(j)` and `poolInUse()`, what `poolRank` reads; `poolBurst()`;
 * the sort's words and its scratch (`poolSortWordsWgsl`); `poolPlaced(total)`; `poolEmit(at, j)`.
 */
export const POOL_SORT_WGSL = wgslBlock(
  'POOL_SORT_WGSL',
  [
    POOL_RANKS_WGSL,
    POOL_RANK_WGSL,
    FLAT_INDEX_WGSL,
    POOL_LANES_WGSL,
    LANE_SCAN_WGSL,
    POOL_SORT_HEAD_WGSL,
    POOL_SORT_STABLE_WGSL,
  ],
  `var<workgroup> poolLocal:array<atomic<u32>,POOL_RANKS>;
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
/** The rank of place order \`d\`: the highest first. */
fn poolRankAt(d:u32)->u32{return POOL_RANKS-1u-d;}
/** A lane's run of ranks, counted. */
fn poolPlaceSum(span:vec2u)->u32{
 var sum=0u;
 for(var d=span.x;d<span.y;d++){sum+=poolCountLoad(poolRankAt(d));}
 return sum;
}
/** A lane's run of ranks handed their first places from \`first\`, their counts zeroed, the
 *  boundary marked where it falls; the place past the run. */
fn poolPlaceRun(span:vec2u,first:u32)->u32{
 var cursor=first;
 for(var d=span.x;d<span.y;d++){
  let r=poolRankAt(d);let taken=poolCountLoad(r);
  poolCountStore(r,0u);poolCountStore(POOL_RANKS+r,cursor);
  if(cursor<poolBurst()&&cursor+taken>=poolBurst()){poolCountStore(POOL_BOUND,r);}
  cursor+=taken;
 }
 return cursor;
}
/** The total ranked: under the burst, no boundary — every slot ranked is staged. */
fn poolPlaceTotal(total:u32){
 poolCountStore(POOL_TOTAL,total);
 if(total<poolBurst()){poolCountStore(POOL_BOUND,POOL_RANKS);}
 poolPlaced(total);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn poolPlace(@builtin(local_invocation_index) lane:u32){
 let span=laneRun(lane,POOL_RANKS);let sum=poolPlaceSum(span);
 let end=poolPlaceRun(span,laneScan(lane,sum)-sum);
 storageBarrier();
 if(lane==WORKGROUP_THREADS-1u){poolPlaceTotal(end);}
}
`,
)

/** The sort's words over \`words\`, an array of atomic u32 of the host's: word \`i\` at \`at(i)\` —
 *  the counts, the places, the boundary and the total (\`POOL_SORT_WORDS\`) —, then scratch word \`i\`
 *  at \`scratchAt(i)\` (\`poolScratchWords\`). A host whose scratch lies elsewhere omits \`scratchAt\`
 *  and declares \`poolScratchLoad\` and \`poolScratchStore\` over its own bindings: no lane of the
 *  sort writes a scratch word another lane of its dispatch reads, so no atomic is needed there. */
export const poolSortWordsWgsl = (
  words: string,
  at: (i: string) => string,
  scratchAt?: (i: string) => string,
) =>
  wgslBlock(
    `poolSortWords ${words}`,
    [],
    `fn poolCountAdd(i:u32,v:u32)->u32{return atomicAdd(&${words}[${at('i')}],v);}
fn poolCountLoad(i:u32)->u32{return atomicLoad(&${words}[${at('i')}]);}
fn poolCountStore(i:u32,v:u32){atomicStore(&${words}[${at('i')}],v);}
${
  scratchAt
    ? `fn poolScratchLoad(i:u32)->u32{return atomicLoad(&${words}[${scratchAt('i')}]);}
fn poolScratchStore(i:u32,v:u32){atomicStore(&${words}[${scratchAt('i')}],v);}
`
    : ''
}`,
  )
