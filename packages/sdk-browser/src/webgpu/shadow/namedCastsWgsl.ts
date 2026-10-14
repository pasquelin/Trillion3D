/**
 * THE ROWS THE CPU NAMES, STALED FROM THEIR SPHERES ON THE GPU (`namedCasts.ts`): a row whose shadow
 * changed where it stands — a cutout's colour tile that came or went, a surface whose alpha moved —
 * appends the box of the sphere the rows pass holds for it (`emitSphere`, `../../placement/rowCastWgsl.ts`)
 * to the rows' shadow changes (`castChanges.ts`). The kernel runs in the rows pass's compute pass,
 * before its derivations: the sphere is the one the row's shadow pages were drawn from, of the page
 * the CPU named it for — the table it was named in was the last one derived —, never one a row
 * written again this frame holds since.
 *
 * Its cast state is the one its sphere was derived with and the one its mobility word says now
 * (`castCode`), as a moved row's is: a row shadowless at both casts nothing and is left; the box is
 * moving — the static slice never held it — when the row was moving at both, else it stales both
 * slices. A row derived before the changes were bound carries no state (0): its mobility word alone
 * says it.
 *
 *   named        array<u32>              word 0 the rows' count, then the rows
 *   spheres      array<f32>              eight floats a row (`../../placement/rowWordsWgsl.ts`)
 *   mobility     array<u32>              a word a row (`../../gpu/shadow/mobilityBits.ts`)
 *   castChanges  array<atomic<u32>>      the list appended to (`castChangesWgsl.ts`)
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { ROW_CAST_WGSL } from '../../placement/rowCastWgsl.ts'

/** The kernel's entry point. */
export const NAMED_CASTS_ENTRY = 'staleNamedRows'

export const NAMED_CASTS_WGSL = wgslProgram(
  `@group(0) @binding(0) var<storage,read> named:array<u32>;
@group(0) @binding(1) var<storage,read> spheres:array<f32>;
@group(0) @binding(2) var<storage,read> mobility:array<u32>;
@group(0) @binding(3) var<storage,read_write> castChanges:array<atomic<u32>>;
fn staleNamed(row:u32){
 if((row+1u)*8u>arrayLength(&spheres)){return;}
 var s:array<f32,8>;
 for(var k=0u;k<8u;k++){s[k]=spheres[row*8u+k];}
 let now=u32(castCode(row))-1u;
 var was=now;
 if(u32(s[7])!=0u){was=u32(s[7])-1u;}
 if((was&now&2u)!=0u){return;}
 emitSphere(s,(was&now&1u)!=0u);
}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${NAMED_CASTS_ENTRY}(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,WORKGROUP_THREADS);
 if(j>=named[0]||j+1u>=arrayLength(&named)){return;}
 staleNamed(named[1u+j]);
}`,
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, ROW_CAST_WGSL],
)
