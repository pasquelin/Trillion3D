import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { dBelow } from '../../../../math/src/wgsl/doubleOrder.ts'
import { dExponent } from '../../../../math/src/wgsl/doubleWords.ts'
import { toF32 } from '../../../../math/src/wgsl/f32.ts'
import { bitMask } from '../../../../math/src/wgsl/integer.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { FLUSH, ROUNDING_GAMMA } from '../water/precision.ts'
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

/** A double the plane test takes in single precision: finite, below 2^60 in magnitude — a product
 *  of two stays below 2^120 and a sum of four below 2^122, far from the single's overflow. */
const BOUNDED_EXPONENT = 1023 + 60
/** A plane's forward-corner word: bits 0 to 2 its normal's positive axes, this one set when every
 *  number of the plane is bounded. */
const PLANE_USABLE = 8

/**
 * THE FRUSTUM VERDICT OF THE TRANSPARENT ITEMS, ON THE GPU, between the compaction that counts each
 * paged item's clusters and the expansion that reads the verdict (`expandWgsl.ts`).
 *
 * `keep(item) = drawn && (paged || !boxExcluded)`. `drawn` is the key record's bit (`keyRecords.ts`):
 * the item's node shown, its row not parked. A paged item draws the clusters the cut selected,
 * which is the finer verdict: its box is not tested again — the old CPU box test could only drop
 * clusters the cut kept while lying entirely outside the frustum, which rasterise no pixel.
 *
 * An unpaged item's box is tested as `frustumExcludesBox` states it — a plane leaves the box's most
 * forward corner behind, the corner chosen by the sign of the plane's double normal — in single
 * precision, with an outward margin that makes a rejection a proof: the box and the planes are the
 * doubles the records hold, each rounded once to single precision (`toF32`), and a plane rejects
 * only when its sum `s = a·x + b·y + c·z + d` falls below `−(γ·m + φ·(1 + r))`, with
 * `m = |a·x| + |b·y| + |c·z| + |d|`, `r = |a| + |b| + |c| + |x| + |y| + |z|`, `γ` and `φ` the
 * rectangle's own guards (`../water/precision.ts`: `ROUNDING_GAMMA` ≈ 64 units of the single's
 * roundoff `u = 2⁻²⁴`, `FLUSH` eight of its smallest normal `2⁻¹²⁶`). The bound: each rounding to
 * single costs `u` relatively and `2⁻¹²⁶` absolutely (a flushed subnormal), so the converted inputs
 * move the exact sum by at most `2.01u·m + 2⁻¹²⁶·(1 + r)`; three products and three sums in any
 * order or fused (a backend may reassociate) move it by at most `γ₄·m + 6·2⁻¹²⁶`, `γ₄ ≈ 4u`; `m`
 * and `r` computed in single precision are within `γ₄` of theirs. The total stays under
 * `6.1u·m + 8·2⁻¹²⁶·(1 + r)`, inside the margin: a rejected box lies outside the plane in exact
 * arithmetic on the records' doubles, so the verdict never culls what the double test keeps, and
 * keeps beyond it only boxes within the margin of a plane. A number past 2⁶⁰, an infinity or a NaN
 * — in the box, the item is kept; in a plane, the plane rejects nothing — never enters the single
 * arithmetic, whose infinities and NaNs a backend may assume away.
 *
 * One thread an item, a workgroup's 64 verdicts packed into its two keep words from workgroup
 * memory; the six planes rounded once a workgroup, by its first six lanes. The frame's counts — the
 * drawn items that draw nothing (`VERDICT_REJECTED`) and the drawn transmissive items the frustum
 * keeps (`VERDICT_IN_VIEW`, a paged one's box tested for it alone) — take one atomic a workgroup;
 * each transmissive item writes whether it draws at its water rank, what the water rectangle reads
 * (`../water/rectWgsl.ts`).
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
var<workgroup> planes:array<f32,24>;
var<workgroup> planeSides:array<u32,6>;
/** Whether double \`v\` enters the single-precision test: finite, below 2^60 in magnitude. */
fn boundedDouble(v:vec2u)->bool{return dExponent(v)<${BOUNDED_EXPONENT}u;}
/** Lane \`lane\` below six: its plane rounded to single precision into workgroup memory, with
 *  its forward-corner word. */
fn planeLane(lane:u32){
 if(lane>=6u){return;}
 let q=FRAME_PLANES+lane*8u;
 var sides=${PLANE_USABLE}u;
 for(var k=0u;k<4u;k++){
  let v=frameDouble(q+2u*k);
  let bounded=boundedDouble(v);
  if(!bounded){sides=0u;}
  planes[lane*4u+k]=select(0.0,bitcast<f32>(toF32(v)),bounded);
  if(k<3u&&dBelow(vec2u(0u,0u),v)){sides=sides|(1u<<k);}
 }
 planeSides[lane]=sides;
}
/** \`frustumExcludesBox\` on the record's box at word \`at\`, proven in single precision: a plane
 *  leaves its most forward corner behind by more than the rounding can move it. */
fn boxExcluded(at:u32)->bool{
 var box:array<f32,6>;
 for(var k=0u;k<6u;k++){
  let v=keyedDouble(at+2u*k);
  if(!boundedDouble(v)){return false;}
  box[k]=bitcast<f32>(toF32(v));
 }
 for(var p=0u;p<6u;p++){
  let sides=planeSides[p];
  if((sides&${PLANE_USABLE}u)==0u){continue;}
  let a=planes[p*4u];
  let b=planes[p*4u+1u];
  let c=planes[p*4u+2u];
  let d=planes[p*4u+3u];
  let x=select(box[0],box[3],(sides&1u)!=0u);
  let y=select(box[1],box[4],(sides&2u)!=0u);
  let z=select(box[2],box[5],(sides&4u)!=0u);
  let s=a*x+b*y+c*z+d;
  let magnitude=abs(a*x)+abs(b*y)+abs(c*z)+abs(d);
  let reach=abs(a)+abs(b)+abs(c)+abs(x)+abs(y)+abs(z);
  if(s< -(${wgslF32(ROUNDING_GAMMA)}*magnitude+${wgslF32(FLUSH)}*(1.0+reach))){return true;}
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
/** The second step of a thread's work: its item's verdict into workgroup memory. */
fn judgeLane(group:u32,lane:u32){
 let item=group*${VERDICT_GROUP}u+lane;
 var v=0u;
 if(item<frame[FRAME_ITEMS]){v=judgeItem(item);}
 bits[lane]=select(0u,bitMask(lane),(v&1u)!=0u);
 if((v&2u)!=0u){atomicAdd(&tally[0],1u);}
 if((v&4u)!=0u){atomicAdd(&tally[1],1u);}
}
/** The last: two lanes write the group's keep words, one adds its counts. */
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
 planeLane(lid.x);
 workgroupBarrier();
 judgeLane(group,lid.x);
 workgroupBarrier();
 packLane(group,lid.x);
}
`,
  [dBelow, dExponent, toF32, bitMask, FLAT_INDEX_WGSL, KEYED_WGSL, FRAME_HEAD_WGSL, VERDICT_WGSL],
)
