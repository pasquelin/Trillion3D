// The kernel that brings the cut's worlds to the eye (`worldRebase.ts`): each translation the
// double subtraction of the eye, then single precision (`DOUBLE_WGSL`, `toF32`).
import { DOUBLE_WGSL } from '../../webgpu/blend/doubleWgsl.ts'
import { TO_F32_WGSL } from '../../placement/f32Wgsl.ts'
import { FLAT_INDEX_WGSL } from '../dispatch/grid.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'

/** One range's words: its placement count, then the eye's three doubles (high word, low word). */
export const WORLD_REBASE_WGSL = wgslProgram(
  `struct Rebase{count:u32,pad:u32,eyeX:vec2u,eyeY:vec2u,eyeZ:vec2u,}
@group(0) @binding(0) var<uniform> rebase:Rebase;
@group(0) @binding(1) var<storage,read_write> worlds:array<u32>;
/** A translation brought to the eye: the double difference, rounded once to single precision. */
fn rebased(t:vec2u,e:vec2u)->u32{return toF32(dSub(t,e));}
/** One placement of the range: its matrix's translation words from the doubles behind the matrices. */
@compute @workgroup_size(64) fn rebaseWorlds(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(id,n,64u);
 if(i>=rebase.count){return;}
 let at=rebase.count*16u+i*8u;
 let eye=array<vec2u,3>(rebase.eyeX,rebase.eyeY,rebase.eyeZ);
 for(var a=0u;a<3u;a++){worlds[i*16u+12u+a]=rebased(vec2u(worlds[at+2u*a],worlds[at+2u*a+1u]),eye[a]);}
}`,
  [DOUBLE_WGSL, TO_F32_WGSL, FLAT_INDEX_WGSL],
)
