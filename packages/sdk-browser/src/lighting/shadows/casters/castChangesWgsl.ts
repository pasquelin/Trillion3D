/**
 * ONE RECORD APPENDED TO THE SHADOW CHANGES (`castChanges.ts`), by the pass that knows a placement
 * changed: the diff of the instances' boxes (`castDiffWgsl.ts`). Its host binds the list as
 * `castChanges:array<atomic<u32>>`. A record is taken by one atomic add on the header's count; one
 * asked past the list sets the header's overflow flag and is not written.
 */
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { CAST_HEADER_WORDS, CAST_RECORD_WORDS } from './castChanges.ts'

/** `emitCast(centre, axisX, axisY, axisZ, moving, views, offset, disableSq)`: the oriented box of centre
 *  `centre` and half axes `axisX`, `axisY`, `axisZ` appended, its sign negative when its casters were
 *  cached as dynamic before and after the change, `views` the bits of the views whose maps it stales
 *  (`ALL_VIEWS` for a change every view sees), `offset` the bits of its placement's word that say its
 *  offset invalidates its shadows or always evaluates, and `disableSq` the square of the distance past
 *  which its object stops evaluating it. */
export const CAST_EMIT_WGSL = wgslBlock(
  'CAST_EMIT_WGSL',
  [],
  `
const ALL_VIEWS:u32=0xffffffffu;
fn emitCast(centre:vec3f,axisX:vec3f,axisY:vec3f,axisZ:vec3f,moving:bool,views:u32,offset:u32,disableSq:f32){
 let k=atomicAdd(&castChanges[0],1u);
 let at=${CAST_HEADER_WORDS}u+k*${CAST_RECORD_WORDS}u;
 if(at+${CAST_RECORD_WORDS}u>arrayLength(&castChanges)){atomicStore(&castChanges[1],1u);return;}
 atomicStore(&castChanges[at],bitcast<u32>(centre.x));
 atomicStore(&castChanges[at+1u],bitcast<u32>(centre.y));
 atomicStore(&castChanges[at+2u],bitcast<u32>(centre.z));
 atomicStore(&castChanges[at+3u],bitcast<u32>(select(1.0,-1.0,moving)));
 atomicStore(&castChanges[at+4u],bitcast<u32>(axisX.x));
 atomicStore(&castChanges[at+5u],bitcast<u32>(axisX.y));
 atomicStore(&castChanges[at+6u],bitcast<u32>(axisX.z));
 atomicStore(&castChanges[at+7u],views);
 atomicStore(&castChanges[at+8u],bitcast<u32>(axisY.x));
 atomicStore(&castChanges[at+9u],bitcast<u32>(axisY.y));
 atomicStore(&castChanges[at+10u],bitcast<u32>(axisY.z));
 atomicStore(&castChanges[at+11u],offset);
 atomicStore(&castChanges[at+12u],bitcast<u32>(axisZ.x));
 atomicStore(&castChanges[at+13u],bitcast<u32>(axisZ.y));
 atomicStore(&castChanges[at+14u],bitcast<u32>(axisZ.z));
 atomicStore(&castChanges[at+15u],bitcast<u32>(disableSq));
}`,
)
