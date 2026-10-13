import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { dAdd, dMul } from '../../../../math/src/wgsl/double.ts'
import { dBelow } from '../../../../math/src/wgsl/doubleOrder.ts'
import { FLAT_INDEX_WGSL } from '../../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { KEYED_WGSL } from './keyLayout.ts'
import { FRAME_HEAD_WGSL } from './frameHead.ts'
import { VERDICT_WGSL } from './verdictLayout.ts'

/** Items one workgroup judges: two keep words. */
export const VERDICT_GROUP = 64

/** Group-0 binding of each buffer the verdict reads or writes, under its WGSL name. */
export const VERDICT_BINDING = {
  keyed: 0,
  draws: 1,
  counts: 2,
  frame: 3,
  keep: 4,
  verdict: 5,
} as const

/** Group-0 layout entries of the verdict: its four inputs, then the keep words and the verdict. */
export function blendVerdictBindEntries(): GPUBindGroupLayoutEntry[] {
  const B = VERDICT_BINDING
  return [
    computeBufferEntry(B.keyed, 'read-only-storage'),
    computeBufferEntry(B.draws, 'read-only-storage'),
    computeBufferEntry(B.counts, 'read-only-storage'),
    computeBufferEntry(B.frame, 'read-only-storage'),
    computeBufferEntry(B.keep, 'storage'),
    computeBufferEntry(B.verdict, 'storage'),
  ]
}

/**
 * THE FRUSTUM VERDICT OF THE TRANSPARENT ITEMS, ON THE GPU, between the compaction that counts each
 * paged item's clusters and the expansion that reads the verdict (`expandWgsl.ts`).
 *
 * `keep(item) = drawn && (paged || !boxExcluded)`. `drawn` is the key record's bit (`keyRecords.ts`):
 * the item's node shown, its row not parked. A paged item draws the clusters the cut selected,
 * which is the finer verdict: its box is not tested again — the old CPU box test could only drop
 * clusters the cut kept while lying entirely outside the frustum, which rasterise no pixel. An
 * unpaged item's box is tested as `frustumExcludesBox` tests it, in emulated doubles
 * (`math/src/wgsl/double.ts`): the same corner, the same products, the same sum left to right, the
 * same `< 0`, a NaN never rejecting — the CPU's verdict, bit for bit.
 *
 * One thread an item, a workgroup's 64 verdicts packed into its two keep words from workgroup
 * memory. The frame's counts — the drawn items that draw nothing (`VERDICT_REJECTED`) and the drawn
 * transmissive items the frustum keeps (`VERDICT_IN_VIEW`, a paged one's box tested for it alone) —
 * take one atomic a workgroup; each transmissive item writes whether it draws at its water rank,
 * what the water rectangle reads (`../water/rectWgsl.ts`).
 */
export const BLEND_VERDICT_SHADER = wgslProgram(
  `@group(0) @binding(${VERDICT_BINDING.keyed}) var<storage,read> keyed:array<u32>;
@group(0) @binding(${VERDICT_BINDING.draws}) var<storage,read> draws:array<vec4u>;
@group(0) @binding(${VERDICT_BINDING.counts}) var<storage,read> counts:array<u32>;
@group(0) @binding(${VERDICT_BINDING.frame}) var<storage,read> frame:array<u32>;
@group(0) @binding(${VERDICT_BINDING.keep}) var<storage,read_write> keep:array<u32>;
@group(0) @binding(${VERDICT_BINDING.verdict}) var<storage,read_write> verdict:array<atomic<u32>>;
var<workgroup> bits:array<u32,${VERDICT_GROUP}>;
var<workgroup> tally:array<atomic<u32>,2>;
/** \`frustumExcludesBox\` on the record's box at word \`at\`: a plane leaves its most forward corner
 *  behind. */
fn boxExcluded(at:u32)->bool{
 let zero=vec2u(0u,0u);
 for(var p=0u;p<6u;p++){
  let q=FRAME_PLANES+p*8u;
  let a=frameDouble(q);
  let b=frameDouble(q+2u);
  let c=frameDouble(q+4u);
  let x=select(keyedDouble(at),keyedDouble(at+6u),dBelow(zero,a));
  let y=select(keyedDouble(at+2u),keyedDouble(at+8u),dBelow(zero,b));
  let z=select(keyedDouble(at+4u),keyedDouble(at+10u),dBelow(zero,c));
  let s=dAdd(dAdd(dAdd(dMul(a,x),dMul(b,y)),dMul(c,z)),frameDouble(q+6u));
  if(dBelow(s,zero)){return true;}
 }
 return false;
}
/** Item \`item\`'s verdict: bit 0 kept, bit 1 drawn yet drawing nothing, bit 2 a transmissive
 *  item in view; its water rank's word written. */
fn judgeItem(item:u32)->u32{
 let at=item*KEY_RECORD_WORDS;
 let flags=keyed[at+KEY_FLAGS];
 let water=keyed[at+KEY_WATER];
 let d=draws[item];
 let paged=d.x!=${NO_INDEX}u;
 if((flags&KEY_DRAWN)==0u){
  if(water!=0u){atomicStore(&verdict[VERDICT_WATER_DRAWS+water-1u],0u);}
  return 0u;
 }
 let excluded=(flags&KEY_HAS_BOX)!=0u&&(!paged||water!=0u)&&boxExcluded(at);
 var held=!excluded;
 if(paged){held=counts[d.x*4u+1u]!=0u;}
 var v=select(0u,1u,paged||!excluded);
 if(!held){v=v|2u;}
 if(water!=0u){
  if(!excluded){v=v|4u;}
  atomicStore(&verdict[VERDICT_WATER_DRAWS+water-1u],select(0u,1u,held));
 }
 return v;
}
/** The first half of a thread's work: its item's verdict into workgroup memory. */
fn judgeLane(group:u32,lane:u32){
 let item=group*${VERDICT_GROUP}u+lane;
 var v=0u;
 if(item<frame[FRAME_ITEMS]){v=judgeItem(item);}
 bits[lane]=select(0u,1u<<(lane&31u),(v&1u)!=0u);
 if((v&2u)!=0u){atomicAdd(&tally[0],1u);}
 if((v&4u)!=0u){atomicAdd(&tally[1],1u);}
}
/** The second half: two lanes write the group's keep words, one adds its counts. */
fn packLane(group:u32,lane:u32){
 if(lane<2u){
  let w=group*2u+lane;
  if(w*32u<frame[FRAME_ITEMS]){
   var word=0u;
   for(var k=0u;k<32u;k++){word=word|bits[lane*32u+k];}
   keep[w]=word;
  }
 }
 if(lane==0u){
  let rejected=atomicLoad(&tally[0]);
  let seen=atomicLoad(&tally[1]);
  if(rejected!=0u){atomicAdd(&verdict[VERDICT_REJECTED],rejected);}
  if(seen!=0u){atomicAdd(&verdict[VERDICT_IN_VIEW],seen);}
 }
}
@compute @workgroup_size(${VERDICT_GROUP})
fn judgeBlendItems(@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) n:vec3u){
 let group=flatIndex(wid,n,1u);
 judgeLane(group,lid.x);
 workgroupBarrier();
 packLane(group,lid.x);
}
`,
  [dAdd, dMul, dBelow, FLAT_INDEX_WGSL, KEYED_WGSL, FRAME_HEAD_WGSL, VERDICT_WGSL],
)
