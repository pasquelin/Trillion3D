/**
 * THE BINS PASS (`rowBinsGpu.ts`): a thread a caster row, after the rows pass wrote its sphere, adds
 * the row to the (s, e) histograms the chunk bound reads a few frames later (`rowPageBound.ts`):
 * one a sun around the reference the CPU sent, along its light-space axes, and the full-map local
 * lights' joint one — its pairs and faces summed over the lights, rounded up to an edge. Each in
 * two populations: the rows of still placements, and the rows of moving ones (`MOBILITY_MOVING`),
 * those binned with their radius grown by the margin the CPU sent, so that a row that travels less
 * than it since still lies in its bin.
 *
 * The binning is the CPU's of before, step for step, in single precision: its roundings — the
 * centre's two halves less the reference's, three dot products, the room — err by a few units in
 * the last place of the row's distance to the reference and of its extent, far below a second
 * `ROOM` of them, which `BIN_ROOM` adds: a row's bin has least s ≤ its s and greatest e ≥ its e.
 *
 * Parameters (`params`, words): a head (`ROW_BINS_HEAD`: first row, end row, suns, lamps, margin,
 * the joint histogram's first word), then a shape a sun (`ROW_BINS_SHAPE`: nine axes, the
 * reference's high and low halves, the extent a unit of radius, the room's scale, whether a row
 * leaving the pyramid is past every range), then a lamp's shape and its range cuts (`ROW_BINS_LAMP`,
 * `rangeCuts`). Histograms (`bins`, words): a sun's still then moving `BIN_SPAN` bins, sun after
 * sun, then the joint pairs (still, moving: `PAIR_EDGES` each) and faces (`MEET_EDGES` each).
 */
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { MOBILITY_MOVING } from '../gpu/shadow/mobilityBits.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import {
  BIN_SPAN,
  E_BINS,
  E_TOP,
  MEET_EDGES,
  PAIR_EDGES,
  ROOM,
  S_TOP,
  TABLE_DEPTH,
  TABLE_MEET_EDGES,
  TABLE_PAIR_EDGES,
  UNIT,
  UNIT_BITS,
} from './rowBins.ts'

/** Words of the head, of a sun's shape, and of a lamp's (its shape, then its range cuts). */
export const ROW_BINS_HEAD = 8,
  ROW_BINS_SHAPE = 20,
  ROW_BINS_LAMP = ROW_BINS_SHAPE + E_BINS
/** Words of the joint histogram: pairs then faces, still then moving. */
export const JOINT_WORDS = 2 * (PAIR_EDGES.length + MEET_EDGES.length)

export const ROW_BINS_WGSL = wgslProgram(
  `
@group(0) @binding(0) var<storage,read> spheres:array<vec4f>;
@group(0) @binding(1) var<storage,read> mobility:array<u32>;
@group(0) @binding(2) var<storage,read> params:array<u32>;
@group(0) @binding(3) var<storage,read> tables:array<u32>;
@group(0) @binding(4) var<storage,read_write> bins:array<atomic<u32>>;

const BIN_ROOM:f32=${wgslF32(2 * ROOM)};
const UNIT:f32=${wgslF32(UNIT)};
const S_TOP:f32=${wgslF32(S_TOP)};
const E_TOP:f32=${wgslF32(E_TOP)};
const UNIT_BITS:i32=${UNIT_BITS};

fn word(at:u32)->f32{return bitcast<f32>(params[at]);}
fn triple(at:u32)->vec3f{return vec3f(word(at),word(at+1u),word(at+2u));}

/** The (s, e) bin of the sphere \`hi + lo\`, radius \`r\`, by the shape at \`at\`. */
fn binOf(at:u32,hi:vec3f,lo:vec3f,r:f32)->u32{
 let d=(hi-triple(at+9u))+(lo-triple(at+12u));
 let x=dot(triple(at),d);
 let y=dot(triple(at+3u),d);
 let z=dot(triple(at+6u),d);
 let rr=r*word(at+15u);
 let e=rr+BIN_ROOM*(word(at+16u)*(abs(d.x)+abs(d.y)+abs(d.z))+rr);
 let reach=max(abs(x),abs(y));
 var least=max(reach,abs(z))-e-(e-rr);
 if(params[at+17u]!=0u&&reach-z>2.0*e){least=S_TOP;}
 let s=select(0.0,min(least,S_TOP),least>=UNIT);
 let top=select(E_TOP,e,e<E_TOP);
 let j=(bitcast<i32>(s)-UNIT_BITS)>>21u;
 let k=(bitcast<i32>(top)-UNIT_BITS)>>22u;
 return u32(select(j+1,0,j<0))*${E_BINS}u+u32(select(k+1,0,k<0));
}

/** The first of the \`n\` edges at \`at\` of \`tables\` at or above \`v\`: \`v\` itself below \`exact\`. */
fn edgeOf(v:u32,at:u32,n:u32,exact:u32)->u32{
 if(v<exact){return v;}
 var lo=exact;
 var hi=n-1u;
 loop{
  if(lo>=hi){break;}
  let mid=(lo+hi)/2u;
  if(tables[at+mid]>=v){hi=mid;}else{lo=mid+1u;}
 }
 return lo;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let row=params[0]+flatIndex(id,groups,64u);
 if(row>=params[1]){return;}
 let hi=spheres[row*2u];
 let lo=spheres[row*2u+1u].xyz;
 let moving=(mobility[row]&${MOBILITY_MOVING}u)!=0u;
 let pop=select(0u,1u,moving);
 let r=hi.w+select(0.0,word(4u),moving);
 let suns=params[2];
 for(var s=0u;s<suns;s++){
  let bin=binOf(${ROW_BINS_HEAD}u+s*${ROW_BINS_SHAPE}u,hi.xyz,lo,r);
  atomicAdd(&bins[(s*2u+pop)*${BIN_SPAN}u+bin],1u);
 }
 let lamps=params[3];
 if(lamps==0u){return;}
 let first=${ROW_BINS_HEAD}u+suns*${ROW_BINS_SHAPE}u;
 var pairs=0u;
 var meets=0u;
 for(var l=0u;l<lamps;l++){
  let at=first+l*${ROW_BINS_LAMP}u;
  let bin=binOf(at,hi.xyz,lo,r);
  let j=bin/${E_BINS}u;
  let k=bin%${E_BINS}u;
  if(j>=params[at+${ROW_BINS_SHAPE}u+k]){continue;}
  let met=select(select(6u,3u,j>=tables[${TABLE_DEPTH}u+k]),1u,params[at+17u]!=0u);
  meets+=met;
  pairs+=met*tables[bin];
 }
 let joint=params[5];
 let pair=edgeOf(pairs,${TABLE_PAIR_EDGES}u,${PAIR_EDGES.length}u,128u);
 let meet=edgeOf(meets,${TABLE_MEET_EDGES}u,${MEET_EDGES.length}u,64u);
 atomicAdd(&bins[joint+pop*${PAIR_EDGES.length}u+pair],1u);
 atomicAdd(&bins[joint+${2 * PAIR_EDGES.length}u+pop*${MEET_EDGES.length}u+meet],1u);
}`,
  [FLAT_INDEX_WGSL],
)
