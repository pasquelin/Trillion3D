/**
 * The two passes that compose linked placements under their parent (`gpuCompose.ts`), in exact
 * double arithmetic (`math/src/wgsl/double.ts`): a world is the parent's world times the child's local matrix,
 * each of the sixteen numbers summed over the same four products in the same order as the
 * transform tree's `multiplyMatrix4`, every product and sum rounded once as the CPU rounds it. A
 * number then reaches single precision as `Float32Array` stores a double (`toF32`), so every word
 * the GPU writes is the CPU's, to the bit; a translation is kept exact, as two words a coordinate,
 * for each cut to take its eye off (`../gpu/dag/shader/worldPoseWgsl.ts`).
 */
import {
  CARRIED_BOX_WGSL,
  CORNERS_WGSL,
  LOD_WGSL,
  WORLD_BOX_WGSL,
} from './gpuComposeDerivedWgsl.ts'
import { NODE_MAX, NODE_MIN } from '../gpu/dag/nodeLayout.ts'
import { nodeTableBlock, WHOLE_LAYOUT, type RefitLayout } from '../gpu/dag/treeRefitWgsl.ts'
import { ROW_INPUT_DOUBLES } from './composedRowPack.ts'
import { CENTRE_ERROR, SPHERE_GROWTH, SPHERE_MARGIN } from './rowSphere.ts'
import { CORNER_VALUES } from '../gpu/partition/contract.ts'
import { ROW_LOD_FLOATS } from '../webgpu/shadow/rowLodWords.ts'
import { ROW_WORDS } from '../visibility/types.ts'
import { ROW_PLACEMENT_WORD } from '../webgpu/row/rowPlacement.ts'
import { dAdd, dMul, dSub } from '../../../math/src/wgsl/double.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { MOTION_WGSL } from './gpuMotionWgsl.ts'
import { STRETCH_WGSL } from './gpuStretchWgsl.ts'
import { FRAME_ROW_WORDS } from '../gpu/dag/types.ts'
import { fromF32, toF32 } from '../../../math/src/wgsl/f32.ts'
import { MOTION_RESET, MOTION_SCAN, MOTION_SKIP } from './composedMotion.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { isNanWord } from '../../../math/src/wgsl/integer.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'

/** The parent slot of a root that follows none. */
export const NONE = 0xffffffff
/** Words of a tree node. */
/** The parts of a row the rows pass derives besides its world words (`params.parts`). */
export const PART_SPHERES = 1,
  PART_CORNERS = 2,
  PART_LODS = 4
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

/** What both passes call: the product, its rounding to single precision and the grid index. */
const SHARED = [PRODUCT_WGSL, toF32, FLAT_INDEX_WGSL]

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
 * its own eye —, the stretch of that world in the root's frame words (`gpuStretchWgsl.ts`), and,
 * once the temporal pass has decided (`motionMode`), the root's motion as `../taa/motion.ts` writes
 * it from the root's single-precision world — the row's words — and the one it held at the last
 * accumulated image (`previous`): a restart takes the world as reference with no motion; a
 * compared image whose world differs writes `previous · current⁻¹` and takes it; any other
 * writes identity.
 */
export const COMPOSE_ROOTS_WGSL = wgslProgram(
  `struct Params{rootCount:u32,first:u32,count:u32,pad:u32,}
struct MotionMode{mode:u32,pad:u32,eyeX:vec2u,eyeY:vec2u,eyeZ:vec2u,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> locals:array<vec2u>;
@group(0) @binding(2) var<storage,read> parentOf:array<u32>;
@group(0) @binding(3) var<storage,read> parents:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> worlds:array<u32>;
@group(0) @binding(5) var<storage,read_write> motion:array<u32>;
@group(0) @binding(6) var<uniform> motionMode:MotionMode;
@group(0) @binding(7) var<storage,read_write> previous:array<u32>;
@group(0) @binding(8) var<storage,read_write> frames:array<u32>;
@group(0) @binding(9) var<storage,read> rootInputs:array<vec2u>;
@group(0) @binding(10) var<storage,read_write> rootBoxes:array<vec2u>;
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
 // The root's world box, which its rows' detail reads the radius of its object from.
 if(rootInputs[rank*7u+6u].x!=0u){var carried:array<vec2u,16>;for(var k=0u;k<16u;k++){carried[k]=composed(p*${MATRIX_DOUBLES}u,rank*${MATRIX_DOUBLES}u,k);}composeBox(rank,rank*7u,carried);}
 // The stretch every cut projects its errors through, in the root's row of the frame words.
 let stretch=maxStretchBits(world);
 if(stretch!=0xffffffffu){frames[i*${FRAME_ROW_WORDS}u]=stretch;}
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
  [...SHARED, SAME_WORD_WGSL, MOTION_WGSL, STRETCH_WGSL, WORLD_BOX_WGSL],
)

/**
 * The world sphere of a linked root's row, what the shadow cull drops a row by, from its composed
 * world and its local box (`inputs`: centre then half extent, the reach in, six doubles). The
 * centre is the double sum, split into a high and a low single; the radius is the farthest corner
 * of the box, in single precision and grown past every rounding: the one formula of `rowSphere.ts`,
 * the CPU's twin step for step.
 */
const SPHERE_WGSL = wgslBlock(
  'SPHERE_WGSL',
  [dAdd, dSub, dMul, fromF32, toF32],
  `
const SPHERE_GROWTH:f32=${SPHERE_GROWTH};
const SPHERE_MARGIN:f32=${SPHERE_MARGIN};
const CENTRE_ERROR:f32=${CENTRE_ERROR};
fn composeSphere(row:u32,world:array<vec2u,16>){
 let at=row*${ROW_INPUT_DOUBLES}u;
 let s=row*8u;
 if(s+8u>arrayLength(&spheres)||at+6u>arrayLength(&inputs)){return;}
 var m:array<f32,9>;
 var size=0.0;
 var sums=0.0;
 for(var i=0u;i<3u;i++){
  var centre=dMul(world[i],inputs[at]);
  var l1=0.0;
  for(var j=0u;j<3u;j++){
   if(j>0u){centre=dAdd(centre,dMul(world[j*4u+i],inputs[at+j]));}
   let w=bitcast<f32>(toF32(world[j*4u+i]));
   m[i*3u+j]=w*bitcast<f32>(toF32(inputs[at+3u+j]));
   size+=abs(w)*abs(bitcast<f32>(toF32(inputs[at+j])));
   l1+=abs(m[i*3u+j]);
  }
  centre=dAdd(centre,world[12u+i]);
  size+=abs(bitcast<f32>(toF32(world[12u+i])));
  let high=toF32(centre);
  var low=0u;
  if(((high>>23u)&0xffu)!=0u){low=toF32(dSub(centre,fromF32(high)));}
  spheres[s+i]=bitcast<f32>(high);
  spheres[s+4u+i]=bitcast<f32>(low);
  sums+=l1*l1;
 }
 var r2=0.0;
 for(var k=0u;k<4u;k++){
  let a=select(-1.0,1.0,(k&1u)==0u);
  let b=select(-1.0,1.0,(k&2u)==0u);
  var norm=0.0;
  for(var i=0u;i<3u;i++){
   let x=m[i*3u]+a*m[i*3u+1u]+b*m[i*3u+2u];
   norm+=x*x;
  }
  r2=max(r2,norm);
 }
 spheres[s+3u]=sqrt(r2)*SPHERE_GROWTH+sqrt(sums)*SPHERE_MARGIN+size*CENTRE_ERROR;
 spheres[s+7u]=0.0;
}`,
)

/**
 * One thread per page-table row (`composeRow`): the world words of a linked root's row and the words
 * derived from them, each part when its buffer is bound (`params.parts`): the world sphere the
 * shadow cull drops the row by (`composeSphere`), the eight corners the Hi-Z test projects it by
 * (`composeCorners`), and the detail the shadows' levels are judged by (`composeLod`) — all from the
 * row's inputs (`composedRowInputs.ts`) and the composed world, so the row keeps the Hi-Z slot the
 * CPU gave it: its corners describe it.
 */
export const COMPOSE_ROWS_WGSL = wgslProgram(
  `struct Params{rootCount:u32,rowCount:u32,parts:u32,pad:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> locals:array<vec2u>;
@group(0) @binding(2) var<storage,read> parentOf:array<u32>;
@group(0) @binding(3) var<storage,read> parents:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> table:array<u32>;
@group(0) @binding(5) var<storage,read_write> spheres:array<f32>;
@group(0) @binding(6) var<storage,read> inputs:array<vec2u>;
@group(0) @binding(7) var<storage,read> rootBoxes:array<vec2u>;
@group(0) @binding(8) var<storage,read_write> corners:array<u32>;
@group(0) @binding(9) var<storage,read_write> lods:array<u32>;
fn composeRow(row:u32){
 let base=row*${ROW_WORDS}u;
 let rank=table[base+${ROW_PLACEMENT_WORD}u];
 if(rank>=params.rootCount){return;}
 let p=parentOf[rank];
 if(p==${NONE}u){return;}
 var world:array<vec2u,16>;
 for(var k=0u;k<16u;k++){
  world[k]=composed(p*${MATRIX_DOUBLES}u,rank*${MATRIX_DOUBLES}u,k);
  let word=toF32(world[k]);
  table[base+k]=word;
 }
 if((params.parts&${PART_SPHERES}u)!=0u){composeSphere(row,world);}
 if((params.parts&${PART_CORNERS}u)!=0u&&(row+1u)*${CORNER_VALUES}u<=arrayLength(&corners)){composeCorners(row,world);}
 if((params.parts&${PART_LODS}u)!=0u&&(row+1u)*${ROW_LOD_FLOATS}u<=arrayLength(&lods)){composeLod(row,rank,world);}
}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let row=flatIndex(g,n,64u);if(row<params.rowCount){composeRow(row);}
}`,
  [...SHARED, SPHERE_WGSL, CORNERS_WGSL, LOD_WGSL],
)

/**
 * One thread per root of a range: the leaf box the placement tree fits over (`treeRefit.ts`) of a
 * root a parent composes — the box of its root node, as the packing holds it, carried by the
 * composed world — in the table of leaf boxes, six doubles a placement, as `memberBox` writes it for
 * a root whose world the CPU holds. A root without a parent, or parked (its root node none), keeps
 * the box it had.
 */
export const composeMembersWgsl = (nodes: RefitLayout['nodes'] = WHOLE_LAYOUT.nodes) =>
  wgslProgram(
    `struct Params{rootCount:u32,first:u32,count:u32,pad:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> locals:array<vec2u>;
@group(0) @binding(2) var<storage,read> parentOf:array<u32>;
@group(0) @binding(3) var<storage,read> parents:array<vec2u>;
@group(0) @binding(4) var<storage,read> frames:array<u32>;
@group(0) @binding(5) var<storage,read_write> members:array<vec2u>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g,n,64u);if(i>=params.count){return;}
 let rank=params.first+i;
 if(rank>=params.rootCount){return;}
 let p=parentOf[rank];
 if(p==${NONE}u){return;}
 let root=frames[i*${FRAME_ROW_WORDS}u+1u];
 if(root==${NONE}u){return;}
 var world:array<vec2u,16>;
 for(var k=0u;k<16u;k++){world[k]=composed(p*${MATRIX_DOUBLES}u,rank*${MATRIX_DOUBLES}u,k);}
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){
  lo[a]=fromF32(nodeWord(root,${NODE_MIN}u+a));
  hi[a]=fromF32(nodeWord(root,${NODE_MAX}u+a));
 }
 let box=carriedBox(world,lo,hi);
 for(var k=0u;k<6u;k++){members[rank*6u+k]=box[k];}
}`,
    [PRODUCT_WGSL, FLAT_INDEX_WGSL, fromF32, CARRIED_BOX_WGSL, nodeTableBlock(nodes, 1, false)],
  )
