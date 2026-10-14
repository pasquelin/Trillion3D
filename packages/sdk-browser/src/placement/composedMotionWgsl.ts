/**
 * The motion pass of the linked placements (`composedMotionPass.ts`): once the temporal pass has
 * decided this image (`motionMode`, `MOTION_*`), each composed root's motion as
 * `../taa/motion.ts` writes it, from the root's single-precision world — the worlds pass's double
 * world rounded as the row's words are (`toF32`) — and the one it held at the last accumulated
 * image (`previous`): a restart takes the world as reference with no motion; a compared image whose
 * world differs writes `previous · current⁻¹` and takes it; any other writes identity.
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { MOTION_WGSL } from './gpuMotionWgsl.ts'
import { toF32 } from '../../../math/src/wgsl/f32.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../math/src/wgsl/constants.ts'
import { isNanWord } from '../../../math/src/wgsl/integer.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'

/**
 * True when two single-precision words are equal as the CPU compares them (`!==` on the numbers
 * they hold): both zeros of either sign, or the same bits unless a NaN.
 */
const SAME_WORD_WGSL = wgslBlock(
  'SAME_WORD_WGSL',
  [isNanWord],
  `
fn sameWord(a:u32,b:u32)->bool{
 return (a==b&&!isNanWord(a))||((a|b)&0x7fffffffu)==0u;
}`,
)

/** What the temporal pass decided for the linked roots' motion this image (`encodeComposedMotion`):
 *  a restart, an image whose poses are not compared, one whose poses are. */
export const MOTION_RESET = 1,
  MOTION_KEEP = 2,
  MOTION_SCAN = 3

/** The motion pass's entry point. */
export const COMPOSE_MOTION_ENTRY = 'composeMotion'

/** One thread per root a parent composes (`ranks`, the composition's dense list of them): its
 *  motion and, on a restart or a compared move, its reference world. */
export const COMPOSE_MOTION_WGSL = wgslProgram(
  `struct Params{rootCount:u32,listed:u32,pad0:u32,pad1:u32,}
struct MotionMode{mode:u32,pad:u32,eyeX:vec2u,eyeY:vec2u,eyeZ:vec2u,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> rootWorlds:array<vec2u>;
@group(0) @binding(2) var<storage,read> parentOf:array<u32>;
@group(0) @binding(3) var<storage,read_write> motion:array<u32>;
@group(0) @binding(4) var<uniform> motionMode:MotionMode;
@group(0) @binding(5) var<storage,read_write> previous:array<u32>;
@group(0) @binding(6) var<storage,read> ranks:array<u32>;
@compute @workgroup_size(WORKGROUP_THREADS) fn composeMotion(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,WORKGROUP_THREADS);if(j>=params.listed){return;}
 let rank=ranks[j];
 if(rank>=params.rootCount){return;}
 if(parentOf[rank]==NO_INDEX){return;}
 let mode=motionMode.mode;
 var words=array<u32,16>(0x3f800000u,0u,0u,0u,0u,0x3f800000u,0u,0u,0u,0u,0x3f800000u,0u,0u,0u,0u,0x3f800000u);
 // An image whose poses are not compared writes identity and reads neither world.
 if(mode!=${MOTION_KEEP}u){
  var world:array<u32,${MATRIX_VALUES}>;
  for(var k=0u;k<${MATRIX_VALUES}u;k++){world[k]=toF32(rootWorlds[rank*${MATRIX_VALUES}u+k]);}
  var taken=mode==${MOTION_RESET}u;
  if(mode==${MOTION_SCAN}u){
   var held:array<u32,${MATRIX_VALUES}>;
   var same=true;
   for(var k=0u;k<${MATRIX_VALUES}u;k++){
    held[k]=previous[rank*${MATRIX_VALUES}u+k];
    same=same&&sameWord(held[k],world[k]);
   }
   if(!same){
    words=motionWords(held,world,array<vec2u,3>(motionMode.eyeX,motionMode.eyeY,motionMode.eyeZ));
    taken=true;
   }
  }
  if(taken){
   for(var k=0u;k<${MATRIX_VALUES}u;k++){previous[rank*${MATRIX_VALUES}u+k]=world[k];}
  }
 }
 for(var k=0u;k<${MATRIX_VALUES}u;k++){motion[rank*${MATRIX_VALUES}u+k]=words[k];}
}`,
  [toF32, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, NO_INDEX, SAME_WORD_WGSL, MOTION_WGSL],
)
