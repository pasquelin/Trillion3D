/**
 * A ROW'S SHADOW CHANGE, AS THE ROWS PASS DERIVES IT (`rowWordsWgsl.ts`): the pages a caster left
 * and the ones it entered go stale, from what the row held before the pass wrote it and what it
 * holds after — its world words, its sphere and its cast state, which the last word of its sphere
 * keeps (`castCode`). The CPU declares no box of a move: the GPU that moves the row says which
 * pages it touched, row by row (`../../lighting/shadows/casters/castChanges.ts`).
 *
 * The cast state is 0 for a row the pass never derived in this sphere buffer, or one it cleared;
 * else 1 + its bits: moving (`MOBILITY_MOVING`, the static slice leaves it out), shadowless
 * (`MOBILITY_SHADOWLESS`, no caster pass draws it), casting far (`MOBILITY_FAR_SHADOW`, a sun's
 * far-shadow test keeps it) and whether that test reaches it or never does (`MOBILITY_FAR_TESTED`,
 * `MOBILITY_FAR_SKIPPED`): its pages are drawn again when either flips. A row whose state was 0 has no pose to leave:
 * its arrival appends the box of the sphere it enters with — the one owner of a caster row's
 * arrival and departure, the CPU declaring neither (`followCasters`) —, moving when the caster is;
 * a sphere buffer made anew stales every page (`spheresMadeAnew`,
 * `../../lighting/shadows/casters/castChanges.ts`).
 *
 * Every row the pass derives that held a page, whatever named it: when its world words, its sphere
 * or its cast state differ — it moved, the table handed it another page or none, its mobility or
 * casting changed —, the box of its sphere before — unless it cast nothing — and the box after —
 * unless it casts nothing, or it lies within the box before — are appended; a row whose
 * single-precision world is the same and whose box after lies within the box before grown by two
 * single-precision steps of its centre — a pose held, rounded again — appends nothing; moving when the caster was moving
 * before and after, which the dynamic slice alone holds. The sphere before is the one its pages
 * were drawn from: no row's words change but here, and every change appends. Each box holds its
 * sphere: the centre's low single is folded into the half extent, grown past the single-precision
 * rounding of that sum (`CAST_GROWTH`). A page no box covers holds no texel the row drew at either
 * pose: never a page missed.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  MOBILITY_FAR_SHADOW,
  MOBILITY_FAR_SKIPPED,
  MOBILITY_FAR_TESTED,
  MOBILITY_MOVING,
  MOBILITY_SHADOWLESS,
} from '../../lighting/shadows/mobilityBits.ts'
import { CAST_EMIT_WGSL } from '../../lighting/shadows/casters/castChangesWgsl.ts'
import { CLUSTER_SPHERE_FLOATS } from '../../lighting/shadows/sphereContract.ts'

/** The growth of a box's half extent past the rounding of the sphere's radius plus its centre's
 *  low single: three single-precision steps, each within `2⁻²⁴` of its result. */
const CAST_GROWTH = 1 + 2 ** -20
/** Two single-precision steps of a value, as a share of it: the most a sphere composed from the same
 *  single-precision world moves by its rounding alone. */
const CAST_HELD_STEPS = 2 ** -22

/** `rowSphere(row)`, the eight floats of a row's sphere; `castCode(row)`, the row's cast state from
 *  its mobility word, and `castState(code)`, its bits; `castRow(row, was, worldSame, has)`, its
 *  change appended from its words before (`was`, its sphere and state); `staleRow(row)`, the box of
 *  its sphere as it stands appended. */
export const ROW_CAST_WGSL = wgslBlock(
  'ROW_CAST_WGSL',
  [CAST_EMIT_WGSL],
  `
const CAST_GROWTH:f32=${wgslF32(CAST_GROWTH)};
const CAST_HELD_STEPS:f32=${wgslF32(CAST_HELD_STEPS)};
fn rowSphere(row:u32)->array<f32,${CLUSTER_SPHERE_FLOATS}>{
 var s:array<f32,${CLUSTER_SPHERE_FLOATS}>;
 for(var k=0u;k<${CLUSTER_SPHERE_FLOATS}u;k++){s[k]=spheres[row*${CLUSTER_SPHERE_FLOATS}u+k];}
 return s;
}
fn castCode(row:u32)->f32{
 var word=0u;
 if(row<arrayLength(&mobility)){word=mobility[row];}
 let moving=select(0u,1u,(word&${MOBILITY_MOVING}u)!=0u);
 let shadowless=select(0u,2u,(word&${MOBILITY_SHADOWLESS}u)!=0u);
 let far=select(0u,4u,(word&${MOBILITY_FAR_SHADOW}u)!=0u);
 let tested=select(0u,8u,(word&${MOBILITY_FAR_TESTED}u)!=0u);
 let skipped=select(0u,16u,(word&${MOBILITY_FAR_SKIPPED}u)!=0u);
 return f32(1u+moving+shadowless+far+tested+skipped);
}
fn castState(code:f32)->u32{return u32(code)-1u;}
fn sphereHalf(s:array<f32,${CLUSTER_SPHERE_FLOATS}>)->f32{return (s[3]+length(vec3f(s[4],s[5],s[6])))*CAST_GROWTH;}
fn sphereCentre(s:array<f32,${CLUSTER_SPHERE_FLOATS}>)->vec3f{return vec3f(s[0],s[1],s[2]);}
fn emitSphere(s:array<f32,${CLUSTER_SPHERE_FLOATS}>,moving:bool){
 emitCast(sphereCentre(s),sphereHalf(s),moving);
}
fn castRow(row:u32,was:array<f32,${CLUSTER_SPHERE_FLOATS}>,worldSame:bool,has:bool){
 if(was[7]==0.0){
  // An arrival in a slot that held no caster: the pages it enters, unless it casts nothing.
  if(has){
   let now=rowSphere(row);
   let after=castState(now[7]);
   if((after&2u)==0u){emitSphere(now,(after&1u)!=0u);}
  }
  return;
 }
 let hw=sphereHalf(was);
 var now:array<f32,${CLUSTER_SPHERE_FLOATS}>;
 var hn=0.0;
 var sphereSame=false;
 var sphereHeld=false;
 if(has){
  now=rowSphere(row);
  hn=sphereHalf(now);
  // Whether the box of now lies within the box of was, then within it grown by two
  // single-precision steps of its centre: the same single-precision world moves the sphere by its
  // rounding alone — a parked body posed again keeps its pages.
  let shift=abs(sphereCentre(now)-sphereCentre(was));
  let centre=abs(sphereCentre(was));
  sphereSame=all(shift+hn<=vec3f(hw));
  sphereHeld=all(shift+hn<=vec3f(hw+max(centre.x,max(centre.y,centre.z))*CAST_HELD_STEPS));
 }
 if(worldSame&&sphereHeld&&now[7]==was[7]){return;}
 let old=castState(was[7]);
 let after=castState(max(now[7],1.0));
 let moving=has&&(old&after&1u)!=0u;
 let left=(old&2u)==0u;
 if(left){emitCast(sphereCentre(was),hw,moving);}
 if(has&&(after&2u)==0u&&!(left&&sphereSame)){emitCast(sphereCentre(now),hn,moving);}
}
fn staleRow(row:u32){
 let s=rowSphere(row);
 let now=castState(castCode(row));
 var was=now;
 if(s[7]!=0.0){was=castState(s[7]);}
 if((was&now&2u)!=0u){return;}
 emitSphere(s,(was&now&1u)!=0u);
}`,
)
