/**
 * THE ROWS PASS, the one writer of every word of a page-table row its root's world decides
 * (`rowWords.ts`): the sixteen world words of the row, the world sphere the shadow cull drops it by,
 * the eight corners the Hi-Z test projects it by and the detail the shadows' levels are judged by —
 * each from the root's world as the GPU holds it in doubles (`rootWorlds.ts`) and the row's inputs
 * (`rowInputPack.ts`), rounded where the CPU's formulas round them (`gpuComposeDerivedWgsl.ts`,
 * `rowSphere.ts`), so a word is the one the CPU would have written from the same world. One thread a
 * row: every row of the table (`params.all`), or the rows a list names.
 */
import { CORNERS_WGSL, LOD_WGSL } from './gpuComposeDerivedWgsl.ts'
import { INPUT_FLAGS, ROW_HAS_RECORD, ROW_INPUT_DOUBLES } from './rowInputPack.ts'
import { CENTRE_ERROR, SPHERE_GROWTH, SPHERE_MARGIN } from './rowSphere.ts'
import { CORNER_VALUES } from '../gpu/partition/contract.ts'
import { ROW_LOD_FLOATS } from '../webgpu/shadow/rowLodWords.ts'
import { ROW_WORDS } from '../visibility/types.ts'
import { dAdd, dMul, splitDouble } from '../../../math/src/wgsl/double.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { toF32 } from '../../../math/src/wgsl/f32.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { FINITE_SENTINEL } from '../../../math/src/wgsl/constants.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'
import { ROW_CAST_WGSL } from './rowCastWgsl.ts'

/** The parts of a row the rows pass derives besides its world words (`params.parts`), each when its
 *  buffer is made; the shadow changes (`PART_CASTS`) once the mobility words and the change list
 *  are made beside the spheres (`rowCastWgsl.ts`). */
export const PART_SPHERES = 1,
  PART_CORNERS = 2,
  PART_LODS = 4,
  PART_CASTS = 8

/** A listed row's word: the row, and whether its shadow change is asked (`ROW_EMITS`). */
export const ROW_NAMED = 0x7fffffff,
  ROW_EMITS = 0x80000000

/**
 * The world sphere of a row, what the shadow cull drops it by, from its root's world and its local
 * box (`inputs`: centre then half extent, the reach in, six doubles). The centre is the double sum,
 * split into a high and a low single; the radius is the farthest corner of the box, in single
 * precision and grown past every rounding: the one formula of `rowSphere.ts`, step for step.
 */
const SPHERE_WGSL = wgslBlock(
  'SPHERE_WGSL',
  [dAdd, dMul, splitDouble, toF32],
  `
const SPHERE_GROWTH:f32=${wgslF32(SPHERE_GROWTH)};
const SPHERE_MARGIN:f32=${wgslF32(SPHERE_MARGIN)};
const CENTRE_ERROR:f32=${wgslF32(CENTRE_ERROR)};
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
  let split=splitDouble(centre);
  spheres[s+i]=bitcast<f32>(split.x);
  spheres[s+4u+i]=bitcast<f32>(split.y);
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

/** The words of a row that holds no page: a zero sphere and zero corners, which no cull keeps, and
 *  the detail every page draws (`FINITE_SENTINEL` as the coarser form's error). */
const CLEAR_ROW_WGSL = wgslBlock(
  'CLEAR_ROW_WGSL',
  [FINITE_SENTINEL],
  `
fn clearRow(row:u32){
 if((params.parts&${PART_SPHERES}u)!=0u&&(row+1u)*8u<=arrayLength(&spheres)){
  for(var k=0u;k<8u;k++){spheres[row*8u+k]=0.0;}
 }
 if((params.parts&${PART_CORNERS}u)!=0u&&(row+1u)*${CORNER_VALUES}u<=arrayLength(&corners)){
  for(var k=0u;k<${CORNER_VALUES}u;k++){corners[row*${CORNER_VALUES}u+k]=0u;}
 }
 if((params.parts&${PART_LODS}u)!=0u&&(row+1u)*${ROW_LOD_FLOATS}u<=arrayLength(&lods)){
  for(var k=0u;k<${ROW_LOD_FLOATS}u;k++){lods[row*${ROW_LOD_FLOATS}u+k]=0u;}
  lods[row*${ROW_LOD_FLOATS}u+7u]=bitcast<u32>(FINITE_SENTINEL);
 }
}`,
)

/** The rows pass's entry point. */
export const DERIVE_ROWS_ENTRY = 'deriveRows'

/**
 * One thread a row (`deriveRow`): a row holding no page takes the clear words (`clearRow`); a row
 * holding one, its root's world as single-precision words and, each part when its buffer is bound
 * (`params.parts`), its sphere (`composeSphere`) and its cast state (`castCode`), its corners
 * (`composeCorners`) and its detail (`composeLod`). The row keeps the Hi-Z slot the CPU gave it:
 * its corners describe it. A row whose shadow change is asked — every row of the table or of the
 * composed list (`params.emitAll`), or a listed row marked `ROW_EMITS` — appends it (`castRow`).
 */
export const DERIVE_ROWS_WGSL = wgslProgram(
  `struct Params{rootCount:u32,parts:u32,listed:u32,all:u32,emitAll:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> rootWorlds:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> table:array<u32>;
@group(0) @binding(3) var<storage,read_write> spheres:array<f32>;
@group(0) @binding(4) var<storage,read> inputs:array<vec2u>;
@group(0) @binding(5) var<storage,read> rootBoxes:array<vec2u>;
@group(0) @binding(6) var<storage,read_write> corners:array<u32>;
@group(0) @binding(7) var<storage,read_write> lods:array<u32>;
@group(0) @binding(8) var<storage,read> rowList:array<u32>;
@group(0) @binding(9) var<storage,read> mobility:array<u32>;
@group(0) @binding(10) var<storage,read_write> castChanges:array<atomic<u32>>;
fn deriveRow(row:u32,emit:bool){
 let at=row*${ROW_INPUT_DOUBLES}u;
 let base=row*${ROW_WORDS}u;
 if(at+${ROW_INPUT_DOUBLES}u>arrayLength(&inputs)||base+${ROW_WORDS}u>arrayLength(&table)){return;}
 let sphered=(params.parts&${PART_SPHERES}u)!=0u&&(row+1u)*8u<=arrayLength(&spheres);
 let cast=emit&&sphered&&(params.parts&${PART_CASTS}u)!=0u;
 var was:array<f32,8>;
 if(cast){for(var k=0u;k<8u;k++){was[k]=spheres[row*8u+k];}}
 if((inputs[at+${INPUT_FLAGS}u].x&${ROW_HAS_RECORD}u)==0u){
  if(cast){castRow(row,was,false,false);}
  clearRow(row);
  return;
 }
 let rank=table[base+${PAGE_INFO.at.placement}u];
 if(rank>=params.rootCount){return;}
 var world:array<vec2u,16>;
 var worldSame=true;
 for(var k=0u;k<16u;k++){
  world[k]=rootWorlds[rank*16u+k];
  let single=toF32(world[k]);
  worldSame=worldSame&&table[base+k]==single;
  table[base+k]=single;
 }
 if(sphered){
  composeSphere(row,world);
  if((params.parts&${PART_CASTS}u)!=0u){spheres[row*8u+7u]=castCode(row);}
 }
 if(cast){castRow(row,was,worldSame,true);}
 if((params.parts&${PART_CORNERS}u)!=0u&&(row+1u)*${CORNER_VALUES}u<=arrayLength(&corners)){composeCorners(row,world);}
 if((params.parts&${PART_LODS}u)!=0u&&(row+1u)*${ROW_LOD_FLOATS}u<=arrayLength(&lods)){composeLod(row,rank,world);}
}
@compute @workgroup_size(WORKGROUP_THREADS) fn deriveRows(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,WORKGROUP_THREADS);if(j>=params.listed){return;}
 var row=j;
 var emit=params.emitAll!=0u;
 if(params.all==0u){
  let named=rowList[j];
  row=named&${ROW_NAMED}u;
  emit=emit||(named&${ROW_EMITS}u)!=0u;
 }
 deriveRow(row,emit);
}`,
  [
    toF32,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    SPHERE_WGSL,
    CLEAR_ROW_WGSL,
    CORNERS_WGSL,
    LOD_WGSL,
    ROW_CAST_WGSL,
  ],
)
