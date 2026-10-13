/**
 * A ROW'S SHADOW CHANGE, AS THE ROWS PASS DERIVES IT (`rowWordsWgsl.ts`): the pages a caster left
 * and the ones it entered go stale, from what the row held before the pass wrote it and what it
 * holds after — its world words, its sphere and its cast state, which the last word of its sphere
 * keeps (`castCode`). The CPU declares no box of a move: the GPU that moves the row says which
 * pages it touched, row by row (`../webgpu/shadow/castChanges.ts`).
 *
 * The cast state is 0 for a row the pass never derived in this sphere buffer, or one it cleared;
 * else 1 + its bits: moving (`MOBILITY_MOVING`, the static slice leaves it out) and shadowless
 * (`MOBILITY_SHADOWLESS`, no caster pass draws it). A row whose state was 0 has no pose to leave
 * known here: its arrival is a residency change, which the CPU declares, and a sphere buffer made
 * anew stales every page (`spheresMadeAnew`, `../webgpu/shadow/castChanges.ts`).
 *
 * A row the pass derives with its change asked (`emit`) and that held a page: when its world words,
 * its sphere or its cast state differ, the box of its sphere before — unless it cast nothing — and
 * the box after — unless it casts nothing, or it is the same box — are appended; moving when the
 * caster was moving before and after, which the dynamic slice alone holds. Each box holds its
 * sphere: the centre's low single is folded into the half extent, grown past the single-precision
 * rounding of that sum (`CAST_GROWTH`), and past the drift a pose its shadows hold may leave
 * between the pose a page was drawn at and the one the row last held (`CAST_DRIFT`: a pose posed
 * again within a float32 step of its box derives its rows without asking their change,
 * `mobility.holds`). A page no box covers holds no texel the row drew at either pose: never a page
 * missed.
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { MOBILITY_MOVING, MOBILITY_SHADOWLESS } from '../gpu/shadow/mobilityBits.ts'
import { CAST_EMIT_WGSL } from '../webgpu/shadow/castChangesWgsl.ts'

/** The growth of a box's half extent past the rounding of the sphere's radius plus its centre's
 *  low single: three single-precision steps, each within `2⁻²⁴` of its result. */
const CAST_GROWTH = 1 + 2 ** -20
/** The drift a held pose leaves, relative to the farthest coordinate of the box: one float32 step
 *  (`2⁻²³` of it at most), four times over. */
const CAST_DRIFT = 2 ** -21

/** `castCode(row)`, `castRow(row, was, worldSame, has)`: the row's cast state from its mobility word,
 *  and its change appended from its words before (`was`, its sphere and state). */
export const ROW_CAST_WGSL = wgslBlock(
  'ROW_CAST_WGSL',
  [CAST_EMIT_WGSL],
  `
const CAST_GROWTH:f32=${wgslF32(CAST_GROWTH)};
const CAST_DRIFT:f32=${wgslF32(CAST_DRIFT)};
fn castCode(row:u32)->f32{
 var word=0u;
 if(row<arrayLength(&mobility)){word=mobility[row];}
 let moving=select(0u,1u,(word&${MOBILITY_MOVING}u)!=0u);
 let shadowless=select(0u,2u,(word&${MOBILITY_SHADOWLESS}u)!=0u);
 return f32(1u+moving+shadowless);
}
fn emitSphere(s:array<f32,8>,moving:bool){
 let centre=vec3f(s[0],s[1],s[2]);
 let far=abs(centre);
 let reach=max(far.x,max(far.y,far.z))+s[3];
 emitCast(centre,(s[3]+length(vec3f(s[4],s[5],s[6])))*CAST_GROWTH+reach*CAST_DRIFT,moving);
}
fn castRow(row:u32,was:array<f32,8>,worldSame:bool,has:bool){
 let before=u32(was[7]);
 if(before==0u){return;}
 var now:array<f32,8>;
 var sphereSame=has;
 if(has){
  for(var k=0u;k<8u;k++){
   now[k]=spheres[row*8u+k];
   if(k<7u&&now[k]!=was[k]){sphereSame=false;}
  }
 }
 if(worldSame&&sphereSame&&now[7]==was[7]){return;}
 let old=before-1u;
 let after=max(u32(now[7]),1u)-1u;
 let moving=has&&(old&after&1u)!=0u;
 let left=(old&2u)==0u;
 if(left){emitSphere(was,moving);}
 if(has&&(after&2u)==0u&&!(left&&sphereSame)){emitSphere(now,moving);}
}`,
)
