/**
 * ONE RECORD APPENDED TO THE SHADOW CHANGES (`castChanges.ts`), by the pass that knows a caster
 * changed: the rows pass (`../../placement/rowCastWgsl.ts`), and the rows the CPU names for a change
 * where they stand (`namedCastsWgsl.ts`). Its host binds the list as
 * `castChanges:array<atomic<u32>>`. A record is taken by one atomic add on the header's count; one
 * asked past the list sets the header's overflow flag and is not written.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { CAST_HEADER_WORDS, CAST_RECORD_WORDS } from './castChanges.ts'

/** The smallest half extent a record holds: the box of a point keeps the sign that says whether its
 *  casters move. Any box may be larger than its casters, never smaller. */
const CAST_MIN_EXTENT = 2 ** -40

/** `emitCast(centre, extent, moving)`: the box of half extent `extent` about `centre` appended, its
 *  extent negative when its casters were moving before and after the change. */
export const CAST_EMIT_WGSL = wgslBlock(
  'CAST_EMIT_WGSL',
  [],
  `
const CAST_MIN_EXTENT:f32=${wgslF32(CAST_MIN_EXTENT)};
fn emitCast(centre:vec3f,extent:f32,moving:bool){
 let k=atomicAdd(&castChanges[0],1u);
 let at=${CAST_HEADER_WORDS}u+k*${CAST_RECORD_WORDS}u;
 if(at+${CAST_RECORD_WORDS}u>arrayLength(&castChanges)){atomicStore(&castChanges[1],1u);return;}
 let e=max(extent,CAST_MIN_EXTENT);
 atomicStore(&castChanges[at],bitcast<u32>(centre.x));
 atomicStore(&castChanges[at+1u],bitcast<u32>(centre.y));
 atomicStore(&castChanges[at+2u],bitcast<u32>(centre.z));
 atomicStore(&castChanges[at+3u],bitcast<u32>(select(e,-e,moving)));
}`,
)
