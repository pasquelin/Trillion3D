/**
 * The two passes that compose linked placements under their parent (`gpuCompose.ts`), in exact
 * double arithmetic (`DOUBLE_WGSL`): a world is the parent's world times the child's local matrix,
 * each of the sixteen numbers summed over the same four products in the same order as the
 * transform tree's `multiplyMatrix4`, every product and sum rounded once as the CPU rounds it. A
 * number then reaches single precision as `Float32Array` stores a double (`toF32`), so every word
 * the GPU writes is the CPU's, to the bit; a translation is brought to the eye first, by the double
 * subtraction `worldToRenderOrigin` does.
 */
import { PAGE_INFO_STRIDE } from '../visibility/buffer.ts'
import { ROW_PLACEMENT_WORD } from '../webgpu/row/rowPlacement.ts'
import { ROW_HIZ_SLOT_WORD } from '../webgpu/row/pageRow.ts'
import { NO_HIZ_SLOT } from '../webgpu/row/noHizSlot.ts'
import { DOUBLE_WGSL } from '../webgpu/blend/doubleWgsl.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { MOTION_WGSL } from './gpuMotionWgsl.ts'
import { FROM_F32_WGSL, TO_F32_WGSL } from './f32Wgsl.ts'
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
  [DOUBLE_WGSL],
  `
fn composed(parentAt:u32,localAt:u32,k:u32)->vec2u{
 let c=k>>2u;let r=k&3u;
 var sum=dMul(parents[parentAt+r],locals[localAt+c*4u]);
 for(var i=1u;i<4u;i++){sum=dAdd(sum,dMul(parents[parentAt+i*4u+r],locals[localAt+c*4u+i]));}
 return sum;
}`,
)

/** What both passes call: the product, its rounding to single precision and the grid index. */
const SHARED = [PRODUCT_WGSL, TO_F32_WGSL, FLAT_INDEX_WGSL]

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
 * One thread per root of a range of the cut's worlds: `parent · local` — its exact translation
 * kept behind the range's matrices, as the host's are (`worldOrigins.ts`), which each cut reads at
 * its own eye —, and,
 * once the temporal pass has decided (`motionMode`), the root's motion as `../taa/motion.ts` writes
 * it from the root's single-precision world — the row's words — and the one it held at the last
 * accumulated image (`previous`): a restart takes the world as reference with no motion; a
 * compared image whose world differs writes `previous · current⁻¹` and takes it; any other
 * writes identity.
 */
export const COMPOSE_ROOTS_WGSL = wgslProgram(
  `struct Params{rootCount:u32,first:u32,count:u32,motion:u32,}
struct MotionMode{mode:u32,pad:u32,eyeX:vec2u,eyeY:vec2u,eyeZ:vec2u,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> locals:array<vec2u>;
@group(0) @binding(2) var<storage,read> parentOf:array<u32>;
@group(0) @binding(3) var<storage,read> parents:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> worlds:array<u32>;
@group(0) @binding(5) var<storage,read_write> motion:array<u32>;
@group(0) @binding(6) var<uniform> motionMode:MotionMode;
@group(0) @binding(7) var<storage,read_write> previous:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g,n,64u);if(i>=params.count){return;}
 let rank=params.first+i;
 if(rank>=params.rootCount){return;}
 let p=parentOf[rank];
 if(p==${NONE}u){return;}
 var world:array<u32,16>;
 for(var k=0u;k<16u;k++){
  let value=composed(p*${MATRIX_DOUBLES}u,rank*${MATRIX_DOUBLES}u,k);
  world[k]=toF32(value);
  // The translation is the exact one behind the range's matrices, which each cut reads at its own
  // eye (\`../gpu/dag/shader/worldPoseWgsl.ts\`): words 12 to 14 of the row are no cut's.
  if(k>=12u&&k<15u){
   let at=params.count*16u+i*8u+2u*(k-12u);
   worlds[at]=value.x;worlds[at+1u]=value.y;
  }else{worlds[i*16u+k]=world[k];}
 }
 let mode=motionMode.mode;
 if(params.motion==0u||mode==${MOTION_SKIP}u){return;}
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
  [...SHARED, DOUBLE_WGSL, SAME_WORD_WGSL, MOTION_WGSL],
)

/**
 * The world sphere of a linked root's row (`../webgpu/shadow/spheres.ts`), what the shadow cull
 * drops a row by, from its composed world and its local box (`localBoxes`: centre then half extent,
 * the reach in, six doubles). The centre is the CPU's double sum in the same order, split into a
 * high and a low single. The radius is the CPU's per-axis overestimate, in single precision, then
 * grown so that it never falls below the CPU's: each axis sum takes at most six roundings of 2⁻²⁴
 * (the matrix and extent words, three products, two sums) and the norm five more, eleven in all,
 * below the 2⁻²⁰ the radius is grown by even after that product's own rounding; the centre's double
 * sum and its split err by less than 2⁻⁴⁸ of the sum of its terms' magnitudes, below the 2⁻⁴⁴ of it
 * that is added. A larger sphere only lets a row reach a page its triangles do not touch: no texel
 * changes.
 */
const SPHERE_WGSL = wgslBlock(
  'SPHERE_WGSL',
  [DOUBLE_WGSL, FROM_F32_WGSL, TO_F32_WGSL],
  `
const SPHERE_GROWTH:f32=1.00000095367431640625;
const CENTRE_ERROR:f32=5.684341886080802e-14;
fn composeSphere(row:u32,world:array<vec2u,16>){
 let at=row*6u;
 let s=row*8u;
 if(s+8u>arrayLength(&spheres)||at+6u>arrayLength(&localBoxes)){return;}
 var r2=0.0;
 var size=0.0;
 for(var i=0u;i<3u;i++){
  var centre=dMul(world[i],localBoxes[at]);
  var axis=0.0;
  for(var j=0u;j<3u;j++){
   if(j>0u){centre=dAdd(centre,dMul(world[j*4u+i],localBoxes[at+j]));}
   let e=abs(bitcast<f32>(toF32(world[j*4u+i])));
   axis+=e*bitcast<f32>(toF32(localBoxes[at+3u+j]));
   size+=e*abs(bitcast<f32>(toF32(localBoxes[at+j])));
  }
  centre=dAdd(centre,world[12u+i]);
  size+=abs(bitcast<f32>(toF32(world[12u+i])));
  let high=toF32(centre);
  var low=0u;
  if(((high>>23u)&0xffu)!=0u){low=toF32(dSub(centre,fromF32(high)));}
  spheres[s+i]=bitcast<f32>(high);
  spheres[s+4u+i]=bitcast<f32>(low);
  r2+=axis*axis;
 }
 spheres[s+3u]=sqrt(r2)*SPHERE_GROWTH+size*CENTRE_ERROR;
 spheres[s+7u]=0.0;
}`,
)

/**
 * One thread per page-table row (`composeRow`): the world words of a linked root's row, and, while
 * a light casts (`params.spheres`), its world sphere (`composeSphere`). Its corners are those of the
 * row's last CPU write, derived from the very world words that write left: while the composed
 * words equal the ones the row holds, the corners describe it and it keeps the Hi-Z slot the CPU
 * gave it, as the CPU's own row does; once they differ it takes no verdict, which no occlusion test
 * may judge it by, until the CPU writes the row again.
 */
export const COMPOSE_ROWS_WGSL = wgslProgram(
  `struct Params{rootCount:u32,rowCount:u32,spheres:u32,pad:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> locals:array<vec2u>;
@group(0) @binding(2) var<storage,read> parentOf:array<u32>;
@group(0) @binding(3) var<storage,read> parents:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> table:array<u32>;
@group(0) @binding(5) var<storage,read_write> spheres:array<f32>;
@group(0) @binding(6) var<storage,read> localBoxes:array<vec2u>;
fn composeRow(row:u32){
 let base=row*${PAGE_INFO_STRIDE / 4}u;
 let rank=table[base+${ROW_PLACEMENT_WORD}u];
 if(rank>=params.rootCount){return;}
 let p=parentOf[rank];
 if(p==${NONE}u){return;}
 var moved=false;
 var world:array<vec2u,16>;
 for(var k=0u;k<16u;k++){
  world[k]=composed(p*${MATRIX_DOUBLES}u,rank*${MATRIX_DOUBLES}u,k);
  let word=toF32(world[k]);
  moved=moved||word!=table[base+k];
  table[base+k]=word;
 }
 if(moved){table[base+${ROW_HIZ_SLOT_WORD}u]=${NO_HIZ_SLOT}u;}
 if(params.spheres!=0u){composeSphere(row,world);}
}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let row=flatIndex(g,n,64u);if(row<params.rowCount){composeRow(row);}
}`,
  [...SHARED, SPHERE_WGSL],
)
