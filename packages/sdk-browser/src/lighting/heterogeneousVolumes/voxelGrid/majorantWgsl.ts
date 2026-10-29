import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { maxChannel } from '../../../../../math/src/wgsl/sampling.ts'
import { VG_TYPES_WGSL } from './gridTypesWgsl.ts'

/**
 * THE GREATEST EXTINCTION OF EACH TOP-LEVEL CELL, and, down a chain of coarser grids, of the whole. A majorant is a float, the greatest
 * channel of the greatest extinction a cell's bottom-level cells hold; it bounds the extinction a ray finds in the cell.
 *
 * The extinction of a bottom-level cell is three half floats in two words (the third in the low half of the second). The three
 * kernels share the bindings: 0 the parameters (uniform), 1 the top-level cells, 2 the indirection cells (the top level's, one word),
 * 3 the extinction cells (two words), 4 the input majorants, 5 the output majorants (two words each).
 */

/** The parameters of the three kernels: the top level's resolution and the input grid's, and whether the indirection grid is in use. */
export const VG_MAJORANT_PARAMS_BYTES = 32

const BINDINGS = `struct VgMajorantParams{
 resolution:vec3i,
 indirection:i32,
 inputSize:vec3i,
 pad:i32,
}
@group(0) @binding(0) var<uniform> params:VgMajorantParams;
@group(0) @binding(1) var<storage,read> topLevel:array<u32>;
@group(0) @binding(2) var<storage,read> indirectionGrid:array<u32>;
@group(0) @binding(3) var<storage,read> extinctionGrid:array<vec2u>;
@group(0) @binding(4) var<storage,read> inputGrid:array<vec2u>;
@group(0) @binding(5) var<storage,read_write> outputGrid:array<vec2u>;
`

export const VG_MAJORANT_WGSL = wgslProgram(
  `${BINDINGS}
fn vgResolutionOf(word:u32)->u32{return word&7u;}

/** The greatest extinction of the bottom-level cells of each top-level cell; zero where none is allocated. Through the
 *  indirection grid a cell holds up to a cube of indirection cells, each its own allocated bottom level. */
@compute @workgroup_size(4,4,4)
fn buildMajorantVoxelGrid(@builtin(global_invocation_id) id:vec3u){
 if(any(vec3i(id)>=params.resolution)){return;}
 var majorant=0.0;
 let index=vgLinearIndex(id,params.resolution);
 let word=topLevel[index];
 if(vgIsAllocated(word)){
  let side=vgResolutionOf(word);
  let count=side*side*side;
  if(params.indirection!=0){
   for(var k=0u;k<count;k++){
    let indirect=indirectionGrid[vgBottomIndex(word)+k];
    if(!vgIsAllocated(indirect)){continue;}
    let inner=vgResolutionOf(indirect);
    let innerCount=inner*inner*inner;
    for(var j=0u;j<innerCount;j++){
     majorant=max(majorant,maxChannel(vgColorOf(extinctionGrid[vgBottomIndex(indirect)+j])));
    }
   }
  }else{
   for(var k=0u;k<count;k++){
    majorant=max(majorant,maxChannel(vgColorOf(extinctionGrid[vgBottomIndex(word)+k])));
   }
  }
 }
 outputGrid[index]=vgSetMajorant(majorant);
}

var<workgroup> groupMajorant:array<f32,64>;

/** Each block of 4 x 4 x 4 cells of the input grid to the greatest majorant it holds: one cell of a grid four times coarser. */
@compute @workgroup_size(4,4,4)
fn downsampleMajorantVoxelGrid(
 @builtin(global_invocation_id) id:vec3u,
 @builtin(local_invocation_id) inBlock:vec3u,
 @builtin(workgroup_id) block:vec3u){
 let slot=mortonEncode3(inBlock);
 groupMajorant[slot]=0.0;
 if(all(vec3i(id)<params.input)){
  groupMajorant[slot]=vgMajorantOf(inputGrid[vgLinearIndex(id,params.input)]);
 }
 workgroupBarrier();
 // The greatest of the 64 by a tree: each step folds the upper half onto the lower, a barrier between the reads and the writes.
 for(var stride=32u;stride>0u;stride=stride>>1u){
  var folded=0.0;
  if(slot<stride){folded=max(groupMajorant[slot],groupMajorant[slot+stride]);}
  workgroupBarrier();
  if(slot<stride){groupMajorant[slot]=folded;}
  workgroupBarrier();
 }
 if(slot==0u){
  let outputRes=(params.input+vec3i(3))/4;
  outputGrid[vgLinearIndex(block,outputRes)]=vgSetMajorant(groupMajorant[0]);
 }
}

/** The greatest majorant of the whole, the last grid's one cell, to the first cell of the majorant grid. */
@compute @workgroup_size(1)
fn copyMaximumIntoMajorantVoxelGrid(){
 outputGrid[0]=vgSetMajorant(vgMajorantOf(inputGrid[0]));
}`,
  [VG_TYPES_WGSL, maxChannel],
)
