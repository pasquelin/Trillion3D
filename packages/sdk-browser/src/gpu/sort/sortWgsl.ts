import { POOL_RANKS_WGSL } from './rankWgsl.ts'
import { POOL_LANES_WGSL, POOL_SORT_HEAD_WGSL } from './sort.ts'
import { POOL_SORT_STABLE_WGSL } from './sortStableWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL } from '../dispatch/grid.ts'
import { LANE_SCAN_WGSL, laneRunOffsets } from '../core/laneScanWgsl.ts'

/**
 * THE VICTIM QUEUE of a GPU pool (#1527): a stable counting sort of the pool's slots by `poolSlotRank`
 * (`rank.ts`), the highest ranks first and, within a rank, the lower slot first — whatever
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
 * `poolSlotRank(j)`, the rank of slot `j` under `poolSlotCount()`, `POOL_RANKS` for a slot in use
 * (the sort asks no other); `poolBurst()`; the sort's words and its scratch (`poolSortWordsWgsl`);
 * `poolPlaced(total)`; `poolEmit(at, j)`.
 */
export const POOL_SORT_WGSL = wgslBlock(
  'POOL_SORT_WGSL',
  [
    POOL_RANKS_WGSL,
    FLAT_INDEX_WGSL,
    POOL_LANES_WGSL,
    LANE_SCAN_WGSL,
    POOL_SORT_HEAD_WGSL,
    POOL_SORT_STABLE_WGSL,
  ],
  `var<workgroup> poolLocal:array<atomic<u32>,POOL_RANKS>;
/** Scratch word of the ranks of slots \`j\` and its pair, behind the staged slots and the groups'
 *  counts: two 16-bit ranks a word (\`POOL_RANKS\` fits). */
fn poolRankWord(j:u32)->u32{return 2u*poolBurst()+2u*ceilDiv(poolSlotCount(),POOL_LANES)+j/2u;}
/** Slot \`j\`'s rank as \`poolCount\` evaluated it, the one evaluation of a sort. */
fn poolRankOf(j:u32)->u32{return (poolScratchLoad(poolRankWord(j))>>(16u*(j&1u)))&0xffffu;}
@compute @workgroup_size(POOL_LANES)
fn poolCount(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let j=flatIndex(id,n,POOL_LANES);
 var rank=POOL_RANKS;
 if(j<poolSlotCount()){rank=poolSlotRank(j);}
 if(rank<POOL_RANKS){atomicAdd(&poolLocal[rank],1u);}
 poolChunk[lane]=rank;
 workgroupBarrier();
 for(var r=lane;r<POOL_RANKS;r+=POOL_LANES){let c=atomicLoad(&poolLocal[r]);if(c>0u){poolCountAdd(r,c);}}
 // The group's ranks kept two to a word, each word written by one lane: the later stages read them.
 if(lane<POOL_LANES/2u){
  let first=j-lane+2u*lane;
  poolScratchStore(poolRankWord(first),poolChunk[2u*lane]|(poolChunk[2u*lane+1u]<<16u));
 }
}
/** The rank of place order \`d\`: the highest first. */
fn poolRankAt(d:u32)->u32{return POOL_RANKS-1u-d;}
/** Rank \`r\` handed its first place \`cursor\`, its count \`taken\` zeroed for the next sort, the
 *  boundary marked where it falls. */
fn poolPlaceAt(r:u32,cursor:u32,taken:u32){
 poolCountStore(r,0u);poolCountStore(POOL_RANKS+r,cursor);
 if(cursor<poolBurst()&&cursor+taken>=poolBurst()){poolCountStore(POOL_BOUND,r);}
}
/** The total ranked: under the burst, no boundary — every slot ranked is staged. */
fn poolPlaceTotal(total:u32){
 poolCountStore(POOL_TOTAL,total);
 if(total<poolBurst()){poolCountStore(POOL_BOUND,POOL_RANKS);}
 poolPlaced(total);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn poolPlace(@builtin(local_invocation_index) lane:u32){
 // The descending place step every counting sort takes (\`laneRunOffsets\`), from the highest rank.
 let span=laneRun(lane,POOL_RANKS);
 ${laneRunOffsets('d', 'span', 'lane', '', 'poolCountLoad(poolRankAt(d))', 'poolPlaceAt(poolRankAt(d),cursor,taken)')}
 storageBarrier();
 if(lane==WORKGROUP_THREADS-1u){poolPlaceTotal(cursor);}
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
