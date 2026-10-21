/**
 * THE ROWS PASS, the one writer of every word of a page-table row its root's world decides
 * (`rowWords.ts`): the sixteen world words of the row, the world sphere the shadow cull drops it by
 * and the detail the shadows' levels are judged by — each from the root's world as the GPU holds it in doubles (`../roots/rootWorlds.ts`) and the row's inputs
 * (`rowInputPack.ts`), rounded where the CPU's formulas round them (`../compose/gpuComposeDerivedWgsl.ts`,
 * `rowSphere.ts`), so a word is the one the CPU would have written from the same world. One thread a
 * row: every row of the table (`params.all`), or the rows a list names.
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { LOD_WGSL } from '../compose/gpuComposeDerivedWgsl.ts'
import { INPUT_FLAGS, ROW_INPUT_DOUBLES } from './rowInputPack.ts'
import { CENTRE_ERROR, SPHERE_GROWTH, SPHERE_MARGIN } from './rowSphere.ts'
import { CLUSTER_SPHERE_FLOATS } from '../../lighting/shadows/sphereContract.ts'
import { LOD_BIT, ROW_LOD_FLOATS } from '../../lighting/shadows/casters/rowLodWords.ts'
import { ROW_WORDS } from '../../visibility/types.ts'
import { splitDouble } from '../../../../math/src/wgsl/double.ts'
import { affineRow } from '../../../../math/src/wgsl/doubleAffine.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { toF32 } from '../../../../math/src/wgsl/f32.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { FINITE_SENTINEL } from '../../../../math/src/wgsl/constants.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import { ROW_CAST_WGSL } from './rowCastWgsl.ts'

/** The parts of a row the rows pass derives besides its world words (`params.parts`), each when its
 *  buffer is made; the shadow changes (`PART_CASTS`) once the mobility words and the change list
 *  are made beside the spheres (`rowCastWgsl.ts`). */
export const PART_SPHERES = 1,
  PART_LODS = 2,
  PART_CASTS = 4

/** A listed row's word: the row, and whether its shadow changed where it stands (`ROW_STALES`): a
 *  cutout's colour tile came or went, its surface's alpha moved — the box of the sphere it holds
 *  appended before it is derived (`staleRow`). */
export const ROW_NAMED = 0x3fffffff,
  ROW_STALES = 0x40000000

/**
 * The world sphere of a row, what the shadow cull drops it by, from its root's world and its local
 * box (`inputs`: centre then half extent, the reach in, six doubles); its caller (`deriveRow`) has
 * checked the row's sphere and inputs are in their buffers. The centre is the double sum,
 * split into a high and a low single; the radius is the farthest corner of the box, in single
 * precision and grown past every rounding: the one formula of `rowSphere.ts`, step for step.
 */
const SPHERE_WGSL = wgslBlock(
  'SPHERE_WGSL',
  [affineRow, splitDouble, toF32],
  `
const SPHERE_GROWTH:f32=${wgslF32(SPHERE_GROWTH)};
const SPHERE_MARGIN:f32=${wgslF32(SPHERE_MARGIN)};
const CENTRE_ERROR:f32=${wgslF32(CENTRE_ERROR)};
fn composeSphere(row:u32,world:array<vec2u,16>){
 let at=row*${ROW_INPUT_DOUBLES}u;
 let s=row*${CLUSTER_SPHERE_FLOATS}u;
 var m:array<f32,9>;
 var size=0.0;
 var sums=0.0;
 for(var i=0u;i<3u;i++){
  let centre=affineRow(world[i],world[4u+i],world[8u+i],world[12u+i],inputs[at],inputs[at+1u],inputs[at+2u]);
  var l1=0.0;
  for(var j=0u;j<3u;j++){
   let w=bitcast<f32>(toF32(world[j*4u+i]));
   m[i*3u+j]=w*bitcast<f32>(toF32(inputs[at+3u+j]));
   size+=abs(w)*abs(bitcast<f32>(toF32(inputs[at+j])));
   l1+=abs(m[i*3u+j]);
  }
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

/** The words of a row that holds no page: a zero sphere, which no cull keeps, and the detail every
 *  page draws (`FINITE_SENTINEL` as the coarser form's error). */
const CLEAR_ROW_WGSL = wgslBlock(
  'CLEAR_ROW_WGSL',
  [FINITE_SENTINEL],
  `
fn clearRow(row:u32){
 if((params.parts&${PART_SPHERES}u)!=0u&&(row+1u)*${CLUSTER_SPHERE_FLOATS}u<=arrayLength(&spheres)){
  for(var k=0u;k<${CLUSTER_SPHERE_FLOATS}u;k++){spheres[row*${CLUSTER_SPHERE_FLOATS}u+k]=0.0;}
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
 * (`params.parts`), its sphere (`composeSphere`) and its cast state (`castCode`), and its detail
 * (`composeLod`). A listed row marked `ROW_STALES` first appends the box of the sphere it
 * holds, the one its shadow pages were drawn from (`staleRow`). Every row derived appends its
 * shadow change (`castRow`), whatever named it — moved, written by the table, made ready, every
 * row —: a row whose world, sphere or cast state differs from what it held stales the pages it was
 * drawn into at the pose it held and those it enters; a row the table hands another page, or none,
 * stales the pages its former page was drawn into, at the pose it was drawn at; a row arriving in a
 * slot that held no caster stales the pages it enters. Residency's one owner of a caster row's
 * shadow change: the CPU declares none (`followCasters`).
 */
export const DERIVE_ROWS_WGSL = wgslProgram(
  `struct Params{rootCount:u32,parts:u32,listed:u32,all:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> rootWorlds:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> table:array<u32>;
@group(0) @binding(3) var<storage,read_write> spheres:array<f32>;
@group(0) @binding(4) var<storage,read> inputs:array<vec2u>;
@group(0) @binding(5) var<storage,read> rootBoxes:array<vec2u>;
@group(0) @binding(6) var<storage,read_write> lods:array<u32>;
@group(0) @binding(7) var<storage,read> rowList:array<u32>;
@group(0) @binding(8) var<storage,read> mobility:array<u32>;
@group(0) @binding(9) var<storage,read_write> castChanges:array<atomic<u32>>;
fn deriveRow(row:u32,stale:bool){
 let at=row*${ROW_INPUT_DOUBLES}u;
 let base=row*${ROW_WORDS}u;
 let sphered=(params.parts&${PART_SPHERES}u)!=0u&&(row+1u)*${CLUSTER_SPHERE_FLOATS}u<=arrayLength(&spheres);
 let casts=sphered&&(params.parts&${PART_CASTS}u)!=0u;
 if(stale&&casts){staleRow(row);}
 if(at+${ROW_INPUT_DOUBLES}u>arrayLength(&inputs)||base+${ROW_WORDS}u>arrayLength(&table)){return;}
 var was:array<f32,${CLUSTER_SPHERE_FLOATS}>;
 if(casts){was=rowSphere(row);}
 if((inputs[at+${INPUT_FLAGS}u].x&${LOD_BIT.record}u)==0u){
  if(casts){castRow(row,was,false,false);}
  clearRow(row);
  return;
 }
 let rank=table[base+${PAGE_INFO.at.placement}u];
 if(rank>=params.rootCount){return;}
 var world:array<vec2u,${MATRIX_VALUES}>;
 var worldSame=true;
 for(var k=0u;k<${MATRIX_VALUES}u;k++){
  world[k]=rootWorlds[rank*${MATRIX_VALUES}u+k];
  let single=toF32(world[k]);
  worldSame=worldSame&&table[base+k]==single;
  table[base+k]=single;
 }
 if(sphered){
  composeSphere(row,world);
  if((params.parts&${PART_CASTS}u)!=0u){spheres[row*${CLUSTER_SPHERE_FLOATS}u+7u]=castCode(row);}
 }
 if(casts){castRow(row,was,worldSame,true);}
 if((params.parts&${PART_LODS}u)!=0u&&(row+1u)*${ROW_LOD_FLOATS}u<=arrayLength(&lods)){composeLod(row,rank,world);}
}
@compute @workgroup_size(WORKGROUP_THREADS) fn deriveRows(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,WORKGROUP_THREADS);if(j>=params.listed){return;}
 var row=j;
 var stale=false;
 if(params.all==0u){
  let named=rowList[j];
  row=named&${ROW_NAMED}u;
  stale=(named&${ROW_STALES}u)!=0u;
 }
 deriveRow(row,stale);
}`,
  [
    toF32,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    SPHERE_WGSL,
    CLEAR_ROW_WGSL,
    LOD_WGSL,
    ROW_CAST_WGSL,
  ],
)
