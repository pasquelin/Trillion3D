import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { HV_INTERSECT_AABB } from '../intersectAabbWgsl.ts'
import { SV_VOXEL_DATA_WGSL } from './voxelDataWgsl.ts'

/**
 * THE MIN TEXTURE'S LEVELS: level 0 is a copy of the baked extinction, each next level the smallest extinction of the block of 2 x 2 x 2 below it
 * (a block cut by the edge reads its edge cell again). The voxels whose value is not zero are the ones a block of eight is filled with.
 * Bindings: 0 the parameters (uniform: the size of the level written, then 0 to copy or 1 to reduce), 1 the level read, 2 the level written.
 */
export const SV_MIN_LEVEL_WGSL = wgslProgram(
  `struct MinParams{size:vec3u,reduce:u32,}
@group(0) @binding(0) var<uniform> params:MinParams;
@group(0) @binding(1) var lowerLevel:texture_3d<f32>;
@group(0) @binding(2) var upperLevel:texture_storage_3d<rgba16float,write>;

@compute @workgroup_size(4,4,4)
fn buildMinLevel(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=params.size)){return;}
 if(params.reduce==0u){
  textureStore(upperLevel,vec3i(id),vec4f(textureLoad(lowerLevel,vec3i(id),0).xyz,1.0));
  return;
 }
 let last=textureDimensions(lowerLevel)-vec3u(1u);
 var smallest=vec3f(3.0e38);
 for(var i=0u;i<8u;i++){
  let cell=min(id*vec3u(2u)+vec3u(i&1u,(i>>1u)&1u,i>>2u),last);
  smallest=min(smallest,textureLoad(lowerLevel,vec3i(cell),0).xyz);
 }
 textureStore(upperLevel,vec3i(id),vec4f(smallest,1.0));
}`,
  [],
)

/**
 * THE HIERARCHY OF BOXES BUILT OVER THE SPARSE VOXELS: the buffer of the boxes holds, for each level of the volume cut in halves, a word a node. A
 * thread a voxel puts its place in the list, plus one, in its node, then marks the nodes above it as holding a leaf, stopping at the first that
 * was already marked. Bindings: 0 the parameters (uniform, the volume's resolution), 1 the voxel counter (read), 2 the voxels (read), 3 the
 * buffer of the boxes (storage). The dispatch is the rows of the voxel list.
 */
export const SV_BOX_HIERARCHY_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:SvParams;
@group(0) @binding(1) var<storage,read> listCounter:array<u32>;
@group(0) @binding(2) var<storage,read> voxels:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> boxes:array<atomic<u32>>;

fn nodeIndex(level:u32,cell:vec3u)->u32{
 let res=max((params.volumeResolution+vec3u((1u<<level)-1u))>>vec3u(level),vec3u(1u));
 return atomicLoad(&boxes[5u+level])+(cell.z*res.y+cell.y)*res.x+cell.x;
}

@compute @workgroup_size(64)
fn buildBoxHierarchy(@builtin(global_invocation_id) id:vec3u){
 let at=id.y*SV_ROW_THREADS+id.x;
 if(at>=listCounter[0]){return;}
 let packed=voxels[at];
 var cell=svDecodeVoxel(packed,params.volumeResolution);
 atomicStore(&boxes[nodeIndex(packed.y,cell)],at+1u);
 let levels=atomicLoad(&boxes[0]);
 for(var level=packed.y+1u;level<levels;level++){
  cell=cell>>vec3u(1u);
  if(atomicOr(&boxes[nodeIndex(level,cell)],0x80000000u)!=0u){break;}
 }
}`,
  [SV_VOXEL_DATA_WGSL],
)

/**
 * THE WALK OF THE HIERARCHY by a ray: hvNextVoxelSpan(origin, direction, tMin, tMax) -> vec2f, the span of the first voxel box the ray of the
 * volume's local space meets in [tMin, tMax], front to back (x above y where it meets none). The nodes under the ray are taken nearest first from a
 * stack, a node past the nearest leaf found being dropped. The program declares hvBoxes (the read-only storage buffer of the boxes,
 * `boxHierarchyPlan.ts`) and hv (the volume's uniform).
 */
export const HV_BOX_WALK_WGSL = wgslBlock(
  'HV_BOX_WALK_WGSL',
  [SV_VOXEL_DATA_WGSL, HV_INTERSECT_AABB],
  `
fn hvBoxVolume()->vec3u{return vec3u(hvBoxes[2],hvBoxes[3],hvBoxes[4]);}
fn hvBoxLevelSize(level:u32)->vec3u{
 return max((hvBoxVolume()+vec3u((1u<<level)-1u))>>vec3u(level),vec3u(1u));
}
fn hvBoxNode(level:u32,cell:vec3u)->u32{
 let res=hvBoxLevelSize(level);
 return hvBoxes[hvBoxes[5u+level]+(cell.z*res.y+cell.y)*res.x+cell.x];
}
fn hvBoxPack(cell:vec3u)->u32{return cell.x|(cell.y<<10u)|(cell.z<<20u);}
fn hvBoxUnpack(packed:u32)->vec3u{return vec3u(packed&1023u,(packed>>10u)&1023u,(packed>>20u)&1023u);}
fn hvNextVoxelSpan(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32)->vec2f{
 var best=vec2f(0.0,-1.0);
 var bestT=tMax;
 let levels=hvBoxes[0];
 let volume=hvBoxVolume();
 let lo=hv.boundsOrigin.xyz-hv.boundsExtent.xyz;
 let size=hv.boundsExtent.xyz*2.0;
 let root=svCellBounds(vec3u(0u),levels-1u,volume,lo,size);
 let entry=hvIntersectAabb(origin,direction,tMin,tMax,root[0],root[1]);
 if(entry.y<=entry.x){return best;}
 var stackLevel:array<u32,96>;
 var stackCell:array<u32,96>;
 var stackT:array<f32,96>;
 stackLevel[0]=levels-1u;
 stackCell[0]=0u;
 stackT[0]=entry.x;
 var top=1u;
 while(top>0u){
  top--;
  if(stackT[top]>=bestT){continue;}
  let level=stackLevel[top];
  let cell=hvBoxUnpack(stackCell[top]);
  let value=hvBoxNode(level,cell);
  if(value==0u){continue;}
  if((value&0x80000000u)==0u){
   // A leaf: its box is the one the list of boxes holds.
   let o=hvBoxes[1]+(value-1u)*6u;
   let box=hvIntersectAabb(origin,direction,tMin,tMax,vec3f(bitcast<f32>(hvBoxes[o]),bitcast<f32>(hvBoxes[o+1u]),bitcast<f32>(hvBoxes[o+2u])),vec3f(bitcast<f32>(hvBoxes[o+3u]),bitcast<f32>(hvBoxes[o+4u]),bitcast<f32>(hvBoxes[o+5u])));
   if(box.y>box.x&&box.x<bestT){bestT=box.x;best=box;}
   continue;
  }
  if(level==0u){continue;}
  // The occupied children the ray meets, the farthest pushed first so that the nearest comes off the stack first.
  var childCell:array<u32,8>;
  var childT:array<f32,8>;
  var count=0u;
  let childSize=hvBoxLevelSize(level-1u);
  for(var i=0u;i<8u;i++){
   let child=cell*vec3u(2u)+vec3u(i&1u,(i>>1u)&1u,i>>2u);
   if(any(child>=childSize)||hvBoxNode(level-1u,child)==0u){continue;}
   let box=svCellBounds(child,level-1u,volume,lo,size);
   let span=hvIntersectAabb(origin,direction,tMin,tMax,box[0],box[1]);
   if(span.y>span.x&&span.x<bestT){
    var k=count;
    for(;k>0u&&childT[k-1u]<span.x;k--){childT[k]=childT[k-1u];childCell[k]=childCell[k-1u];}
    childT[k]=span.x;
    childCell[k]=hvBoxPack(child);
    count++;
   }
  }
  for(var k=0u;k<count&&top<96u;k++){
   stackLevel[top]=level-1u;
   stackCell[top]=childCell[k];
   stackT[top]=childT[k];
   top++;
  }
 }
 return best;
}
`,
)
