/**
 * The passes that compose linked placements under their parent (`gpuCompose.ts`), in exact double
 * arithmetic (`math/src/wgsl/double.ts`): a world is the parent's world times the child's local
 * matrix, each of the sixteen numbers summed over the same four products in the same order as the
 * transform tree's `multiplyMatrix4`, every product and sum rounded once as the CPU rounds it. The
 * worlds pass writes it once a root into the roots' double worlds (`rootWorlds.ts`), which every
 * other pass reads — the roots pass, the root boxes pass, the tree's leaves, the rows pass
 * (`rowWordsWgsl.ts`): no pass composes it again. A number reaches single precision as
 * `Float32Array` stores a double (`toF32`), so every word the GPU writes is the CPU's, to the bit;
 * a translation is kept exact, as two words a coordinate, for each cut to take its eye off
 * (`../gpu/dag/shader/worldPoseWgsl.ts`).
 */
import { dAdd, dMul } from '../../../math/src/wgsl/double.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { MOTION_WGSL } from './gpuMotionWgsl.ts'
import { toF32 } from '../../../math/src/wgsl/f32.ts'
import { MOTION_RESET, MOTION_SCAN, MOTION_SKIP } from './composedMotion.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { isNanWord } from '../../../math/src/wgsl/integer.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'

/** The parent slot of a root that follows none. */
export const NONE = 0xffffffff
/** Doubles of one matrix, each two words. */
export const MATRIX_DOUBLES = 16

/** Element `k` (column-major) of `parent · local`, both read as doubles from their first word:
 *  column `k >> 2`, row `k & 3`, the shift and mask being the division and remainder by four of
 *  an unsigned integer, and integer work a JavaScript run of the text reads as written. */
const PRODUCT_WGSL = wgslBlock(
  'PRODUCT_WGSL',
  [dAdd, dMul],
  `
fn composed(parentAt:u32,localAt:u32,k:u32)->vec2u{
 let c=k>>2u;let r=k&3u;
 var sum=dMul(parents[parentAt+r],locals[localAt+c*4u]);
 for(var i=1u;i<4u;i++){sum=dAdd(sum,dMul(parents[parentAt+i*4u+r],locals[localAt+c*4u+i]));}
 return sum;
}`,
)

/** The worlds pass's entry point. */
export const COMPOSE_WORLDS_ENTRY = 'composeWorlds'

/**
 * One thread per root a parent composes (`ranks`, the composition's dense list of them): its world,
 * `parent · local`, into the roots' double worlds (`rootWorlds`). The one place a composed world is
 * multiplied: the roots pass, the root boxes pass (`rootBoxesWgsl.ts`), the tree's leaves and the
 * rows pass read it.
 */
export const COMPOSE_WORLDS_WGSL = wgslProgram(
  `struct Params{rootCount:u32,listed:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> locals:array<vec2u>;
@group(0) @binding(2) var<storage,read> parentOf:array<u32>;
@group(0) @binding(3) var<storage,read> parents:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> rootWorlds:array<vec2u>;
@group(0) @binding(5) var<storage,read> ranks:array<u32>;
@compute @workgroup_size(64) fn composeWorlds(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,64u);if(j>=params.listed){return;}
 let rank=ranks[j];
 if(rank>=params.rootCount){return;}
 let p=parentOf[rank];
 if(p==${NONE}u){return;}
 for(var k=0u;k<16u;k++){
  rootWorlds[rank*16u+k]=composed(p*${MATRIX_DOUBLES}u,rank*${MATRIX_DOUBLES}u,k);
 }
}`,
  [PRODUCT_WGSL, FLAT_INDEX_WGSL],
)

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

/**
 * One thread per root a parent composes (`ranks`, the composition's dense list of them), those of a
 * range of the cut's worlds alone at work: its composed world as the worlds pass wrote it — its
 * exact translation kept behind the range's matrices, as the host's are (`worldOrigins.ts`), which
 * each cut reads at its own eye —, and,
 * once the temporal pass has decided (`motionMode`), the root's motion as `../taa/motion.ts` writes
 * it from the root's single-precision world — the row's words — and the one it held at the last
 * accumulated image (`previous`): a restart takes the world as reference with no motion; a
 * compared image whose world differs writes `previous · current⁻¹` and takes it; any other
 * writes identity.
 */
export const COMPOSE_ROOTS_WGSL = wgslProgram(
  `struct Params{rootCount:u32,first:u32,count:u32,listed:u32,}
struct MotionMode{mode:u32,pad:u32,eyeX:vec2u,eyeY:vec2u,eyeZ:vec2u,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> rootWorlds:array<vec2u>;
@group(0) @binding(2) var<storage,read> parentOf:array<u32>;
@group(0) @binding(3) var<storage,read_write> worlds:array<u32>;
@group(0) @binding(4) var<storage,read_write> motion:array<u32>;
@group(0) @binding(5) var<uniform> motionMode:MotionMode;
@group(0) @binding(6) var<storage,read_write> previous:array<u32>;
@group(0) @binding(7) var<storage,read> ranks:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,64u);if(j>=params.listed){return;}
 let rank=ranks[j];
 if(rank<params.first||rank>=params.first+params.count||rank>=params.rootCount){return;}
 let i=rank-params.first;
 let p=parentOf[rank];
 if(p==${NONE}u){return;}
 var world:array<u32,16>;
 for(var k=0u;k<16u;k++){
  let value=rootWorlds[rank*16u+k];
  world[k]=toF32(value);
  // The translation is the exact one behind the range's matrices, which each cut reads at its own
  // eye (\`../gpu/dag/shader/worldPoseWgsl.ts\`): words 12 to 14 of the row are no cut's.
  if(k>=12u&&k<15u){
   let at=params.count*16u+i*8u+2u*(k-12u);
   worlds[at]=value.x;worlds[at+1u]=value.y;
  }else{worlds[i*16u+k]=world[k];}
 }
 let mode=motionMode.mode;
 if(mode==${MOTION_SKIP}u){return;}
 var held:array<u32,16>;
 var same=true;
 for(var k=0u;k<16u;k++){
  held[k]=previous[rank*16u+k];
  same=same&&sameWord(held[k],world[k]);
 }
 var words=array<u32,16>(0x3f800000u,0u,0u,0u,0u,0x3f800000u,0u,0u,0u,0u,0x3f800000u,0u,0u,0u,0u,0x3f800000u);
 if(mode==${MOTION_SCAN}u&&!same){
  words=motionWords(held,world,array<vec2u,3>(motionMode.eyeX,motionMode.eyeY,motionMode.eyeZ));
 }
 if(mode==${MOTION_RESET}u||(mode==${MOTION_SCAN}u&&!same)){
  for(var k=0u;k<16u;k++){previous[rank*16u+k]=world[k];}
 }
 for(var k=0u;k<16u;k++){motion[rank*16u+k]=words[k];}
}`,
  [toF32, FLAT_INDEX_WGSL, SAME_WORD_WGSL, MOTION_WGSL],
)
