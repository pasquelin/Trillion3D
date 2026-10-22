import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { recordTextureWgsl } from '../../gpu/core/recordTextureWgsl.ts'
import { workgroupTallyWgsl } from '../../gpu/core/workgroupTallyWgsl.ts'
import { COLD_TABLE } from '../../geometry/dag/cut/cutTables.ts'
import { ACTOR_ROW } from '../../geometry/dag/worlds/worldLinks.ts'
import { linkDrawsWgsl } from '../../geometry/dag/shader/worldGateWgsl.ts'
import { dSub } from '../../../../math/src/wgsl/double.ts'
import { dExponent } from '../../../../math/src/wgsl/doubleWords.ts'
import { toF32 } from '../../../../math/src/wgsl/f32.ts'
import { bitMask } from '../../../../math/src/wgsl/integer.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { FLUSH, ROUNDING_GAMMA } from '../../../../math/src/float/guards.ts'
import { FLAT_INDEX_WGSL } from '../../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { KEYED_WGSL } from '../keyLayout.ts'
import { FRAME_HEAD_WGSL } from '../frame/frameHead.ts'
import { VERDICT_WGSL } from './verdictLayout.ts'
import { SINGLE_BOUND_LOG2 } from '../frame/framePlanes.ts'

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
  cells: 6,
} as const

/** Group-0 layout entries of the verdict: its four inputs, the keep words, the verdict, then the
 *  cut's cold words where the world's cell states lie. */
export function blendVerdictBindEntries(): GPUBindGroupLayoutEntry[] {
  const B = VERDICT_BINDING
  return [
    computeBufferEntry(B.keyed, 'read-only-storage'),
    computeBufferEntry(B.draws, 'read-only-storage'),
    computeBufferEntry(B.counts, 'read-only-storage'),
    computeBufferEntry(B.frame, 'read-only-storage'),
    computeBufferEntry(B.keep, 'storage'),
    computeBufferEntry(B.verdict, 'storage'),
    computeTextureEntry(B.cells, 'uint', '2d-array'),
  ]
}

/** The exponent field below which a double enters the single-precision test (`../frame/framePlanes.ts`). */
const BOUNDED_EXPONENT = 1023 + SINGLE_BOUND_LOG2

/**
 * THE FRUSTUM VERDICT OF THE TRANSPARENT ITEMS, ON THE GPU, between the compaction that counts each
 * item's clusters and the expansion that reads the verdict (`../expand/expandWgsl.ts`).
 *
 * `keep(item) = drawn && listed`. `drawn` is the key record's bit (`../keyRecords.ts`) — the item's
 * node shown, its row not parked — and its row's cell file, shown as its main cell, or its HLOD 0
 * cell drawing its placements: their words in the cut's cold words, the very words the descent
 * gates an opaque placement by (`../../geometry/dag/shader/worldGateWgsl.ts`), so a switch
 * rewrites no record; `listed`, the
 * table holds its clusters (`../statics.ts`). An item draws the clusters the cut selected, which is
 * the finer verdict: its box is not tested for that — a box test could only drop clusters the cut
 * kept while lying entirely outside the frustum, which
 * rasterise no pixel.
 *
 * A transmissive item's box is tested for the distortion alone, as `frustumExcludesBox` states it — a
 * plane leaves the box's most forward corner behind, the corner chosen by the sign of the plane's
 * double normal — RELATIVE TO THE EYE, in single precision, with an outward margin that makes a
 * rejection a proof. Each bound is the record's double minus the eye's, rounded once to double
 * (`dSub`) then once to single (`toF32`); each plane is the CPU's, written once a frame for every
 * workgroup (`../frame/framePlanes.ts`): its normal rounded to single, its offset its value at the eye
 * raised past every double rounding, then rounded to single. As `a·x + d = a·(x − e) + (a·e + d)`
 * exactly, the sum `s = a·x' + b·y' + c·z' + d'` on the exact eye-relative bounds and the raised
 * offset is never below the exact world one: the raise only keeps more. A plane rejects when `s`
 * falls below `−(γ·m + φ·(1 + r))`, with `m = |a·x'| + |b·y'| + |c·z'| + |d'|`,
 * `r = |a| + |b| + |c| + |x'| + |y'| + |z'|`, `γ` and `φ` the single-precision guards
 * (`math/src/float/guards.ts`: `ROUNDING_GAMMA` ≈ 64 units of the single's roundoff `u = 2⁻²⁴`,
 * `FLUSH` eight of its smallest normal `2⁻¹²⁶`). The bound: a bound costs `u + 2⁻⁵³` relatively
 * (its two roundings) and a plane number `u`, each `2⁻¹²⁶` absolutely (a flushed subnormal), so the
 * converted inputs move the sum by at most `2.01u·m + 2⁻¹²⁶·(1 + r)`; three products and three sums
 * in any order or fused (a backend may reassociate) move it by at most `γ₄·m + 6·2⁻¹²⁶`, `γ₄ ≈ 4u`;
 * `m` and `r` computed in single precision are within `γ₄` of theirs. The total stays under
 * `6.1u·m + 8·2⁻¹²⁶·(1 + r)`, inside the margin: a rejected box lies outside the plane in exact
 * arithmetic on the records' doubles, so the verdict never culls what the double test keeps. The
 * margin scales with `m`, the box's and the plane's reach FROM THE EYE: a box beside an eye far
 * from the origin is judged as finely as one beside the origin, and kept beyond the double test
 * only within that margin of a plane. A number past `2^SINGLE_BOUND_LOG2`, an infinity or a NaN —
 * in the box, the item is kept; in a plane or the eye, the plane rejects nothing — never enters the
 * single arithmetic, whose infinities and NaNs a backend may assume away.
 *
 * One thread an item, a workgroup's 64 verdicts packed into its two keep words from workgroup
 * memory. The frame's counts — the drawn items that draw nothing (`VERDICT_REJECTED`) and the drawn
 * transmissive items the frustum keeps (`VERDICT_IN_VIEW`, their box tested for it alone) —
 * are counted in the workgroup and poured with one atomic a workgroup (`workgroupTallyWgsl`); its
 * `flushTally` barrier is the one that also puts every lane's `bits` in place for `packLane`, which
 * only reads them, after it.
 */
export const BLEND_VERDICT_SHADER = wgslProgram(
  `@group(0) @binding(${VERDICT_BINDING.keyed}) var<storage,read> keyed:array<u32>;
@group(0) @binding(${VERDICT_BINDING.draws}) var<storage,read> draws:array<vec4u>;
@group(0) @binding(${VERDICT_BINDING.counts}) var<storage,read> counts:array<u32>;
@group(0) @binding(${VERDICT_BINDING.frame}) var<storage,read> frame:array<u32>;
@group(0) @binding(${VERDICT_BINDING.keep}) var<storage,read_write> keep:array<u32>;
@group(0) @binding(${VERDICT_BINDING.verdict}) var<storage,read_write> verdict:array<atomic<u32>>;
var<workgroup> bits:array<u32,${VERDICT_GROUP}>;
/** Whether the item whose record starts at word \`at\`, its flags \`flags\`, draws as the descent
 *  opens a placement (\`worldCovers\`, by \`linkDraws\`): its cell file's word — from \`FRAME_FILE_STATES\`, its main
 *  cell shown — or its HLOD 0 cell's — \`FRAME_CELL_COUNT\` per instance from \`FRAME_CELL_STATES\` —
 *  draws its placements (\`CELL_DRAW\`). An item in neither, or a cut that follows no world, is
 *  drawn; one whose file has no slot yet (\`KEY_FILED\`), by its HLOD 0 cell alone; a row of a
 *  cell's actor (\`ACTOR_ROW\`) while its cell draws that actor. An instance the cut does not pack
 *  (\`NO_INDEX\`, \`../keyRecords.ts\`) has no state word: its cell word is zero. */
fn cellDraws(at:u32,flags:u32)->bool{
 let base=frame[FRAME_CELL_STATES];
 let cell=keyed[at+KEY_CELL];
 let file=keyed[at+KEY_FILE];
 let instance=keyed[at+KEY_INSTANCE];
 if(base==0u||(cell==${NO_INDEX}u&&(flags&KEY_FILED)==0u)){return true;}
 let slot=base+instance*frame[FRAME_CELL_COUNT];
 var cellWord=0u;
 if(cell!=${NO_INDEX}u&&instance!=${NO_INDEX}u){cellWord=cellsWord(slot+(cell&~${ACTOR_ROW}u),0u).x;}
 var fileWord=0u;
 if(file!=${NO_INDEX}u){fileWord=cellsWord(frame[FRAME_FILE_STATES]+file,0u).x;}
 return linkDraws(cell,cellWord,fileWord);
}
/** Whether double \`v\` enters the single-precision test: finite, below 2^60 in magnitude. */
fn boundedDouble(v:vec2u)->bool{return dExponent(v)<${BOUNDED_EXPONENT}u;}
/** \`frustumExcludesBox\` on the record's box at word \`at\`, proven in single precision
 *  relative to the eye: a plane leaves its most forward corner behind by more than the rounding
 *  can move it. Each of the eye's doubles is loaded once, for its two bounds. The eye is not
 *  tested here: one past the bound, an infinity or a NaN clears \`PLANE_USABLE\` on all six planes
 *  (\`writeFramePlanes\`, from the very eye the frame's doubles hold, \`order.ts\`), so no plane
 *  rejects and the bounds brought to it are never read. */
fn boxExcluded(at:u32)->bool{
 var box:array<f32,6>;
 for(var k=0u;k<3u;k++){
  let e=frameDouble(FRAME_EYE+2u*k);
  let lo=keyedDouble(at+2u*k);
  let hi=keyedDouble(at+2u*(k+3u));
  if(!boundedDouble(lo)||!boundedDouble(hi)){return false;}
  box[k]=bitcast<f32>(toF32(dSub(lo,e)));
  box[k+3u]=bitcast<f32>(toF32(dSub(hi,e)));
 }
 for(var p=0u;p<6u;p++){
  let sides=frame[FRAME_SIDES+p];
  if((sides&PLANE_USABLE)==0u){continue;}
  let q=FRAME_PLANES+p*4u;
  let a=bitcast<f32>(frame[q]);
  let b=bitcast<f32>(frame[q+1u]);
  let c=bitcast<f32>(frame[q+2u]);
  let d=bitcast<f32>(frame[q+3u]);
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
 *  item in view. */
fn judgeItem(item:u32)->u32{
 let at=item*KEY_RECORD_WORDS;
 let flags=keyed[at+KEY_FLAGS];
 let d=draws[item];
 let listed=d.x!=${NO_INDEX}u;
 if((flags&KEY_DRAWN)==0u||!cellDraws(at,flags)){return 0u;}
 let transmits=(flags&KEY_TRANSMITS)!=0u;
 let excluded=(flags&KEY_HAS_BOX)!=0u&&transmits&&boxExcluded(at);
 let held=listed&&counts[d.x*4u+1u]!=0u;
 var v=select(0u,1u,listed);
 if(!held){v=v|2u;}
 if(transmits&&!excluded){v=v|4u;}
 return v;
}
/** The first step of a thread's work: its item's verdict into workgroup memory. */
fn judgeLane(group:u32,lane:u32){
 let item=group*${VERDICT_GROUP}u+lane;
 var v=0u;
 if(item<frame[FRAME_ITEMS]){v=judgeItem(item);}
 bits[lane]=select(0u,bitMask(lane),(v&1u)!=0u);
 if((v&2u)!=0u){tallyAdd(0u,1u);}
 if((v&4u)!=0u){tallyAdd(1u,1u);}
}
/** The last: two lanes write the group's keep words. */
fn packLane(group:u32,lane:u32){
 if(lane<2u){
  let w=group*2u+lane;
  if(w*32u<frame[FRAME_ITEMS]){
   var word=0u;
   for(var k=0u;k<32u;k++){word=word|bits[lane*32u+k];}
   keep[w]=word;
  }
 }
}
@compute @workgroup_size(${VERDICT_GROUP})
fn judgeBlendItems(@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) n:vec3u){
 let group=flatIndex(wid,n,1u);
 judgeLane(group,lid.x);
 flushTally(lid.x);
 packLane(group,lid.x);
}
`,
  [
    workgroupTallyWgsl(
      'VERDICT_TALLY_WGSL',
      2,
      VERDICT_GROUP,
      'atomicAdd(&verdict[select(VERDICT_REJECTED,VERDICT_IN_VIEW,lane==1u)],n);',
    ),
    dSub,
    dExponent,
    toF32,
    bitMask,
    linkDrawsWgsl,
    FLAT_INDEX_WGSL,
    KEYED_WGSL,
    FRAME_HEAD_WGSL,
    VERDICT_WGSL,
    recordTextureWgsl(COLD_TABLE, {
      name: 'cells',
      group: 0,
      binding: VERDICT_BINDING.cells,
      access: 'read',
    }),
  ],
)
