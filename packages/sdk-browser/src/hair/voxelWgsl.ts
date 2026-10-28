import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { indirectArgsWgsl } from '../gpu/dispatch/grid.ts'
import { HAIR_AABB_PRECISION_SCALE } from './boundsWgsl.ts'
import { MAX_MACRO_GROUPS } from './macroGroups.ts'
import {
  HAIR_VOXEL_ALLOCATE_THREADS,
  HAIR_VOXEL_MARK_THREADS,
  HAIR_VOXEL_PAGE_GROUP,
} from './voxelMath.ts'

/** The size of a voxel is stored on this many bits of the range up to the greatest voxel. */
const SIZE_STEPS = 2047

/**
 * WHAT THE PASSES OVER THE VOXELS SHARE: the parameters of the volume (`VoxelParams`, which each program
 * binds as `params`: `VOXEL_PARAMS_WGSL` at binding 0 of group 0), a voxel width stored on eleven bits, and the coordinates of a page in the page index of a
 * macro group, the index of a page in the order of its coordinates (x first) from the group's offset in
 * the index.
 */
export const VOXEL_COMMON_WGSL = wgslBlock(
  'HAIR_VOXEL_COMMON_WGSL',
  [],
  `const INVALID_PAGE=0xFFFFFFFFu;
const INVALID_MACRO=0xFFu;
const PRECISION=${HAIR_AABB_PRECISION_SCALE}.0;
struct VoxelParams{
 cpuPageWorldSize:f32,cpuVoxelWorldSize:f32,useCpuVoxelSize:u32,totalPageIndexCount:u32,
 pageResolution:u32,macroGroupCount:u32,supportMask:u32,pageCount:u32,
 pageStride:u32,correctionThreshold:f32,correctionSpeed:f32,cpuAllocatedPages:u32,
 minVoxelSize:f32,maxVoxelSize:f32,entryCount:u32,registeredCount:u32}
fn packVoxelSize(size:f32)->u32{return u32(saturate(size/params.maxVoxelSize)*${SIZE_STEPS}.0);}
fn unpackVoxelSize(packed:u32)->f32{return f32(packed&0x7ffu)*(params.maxVoxelSize/${SIZE_STEPS}.0);}
fn quantizeVoxelSize(size:f32)->f32{return unpackVoxelSize(packVoxelSize(size));}
fn coordToIndex(coord:vec3u,resolution:vec3u,offset:u32)->u32{return coord.x+coord.y*resolution.x+coord.z*resolution.x*resolution.y+offset;}
fn indexToCoord(index:u32,resolution:vec3u)->vec3u{
 let slice=resolution.x*resolution.y;
 let inSlice=index%slice;
 return vec3u(inSlice%resolution.x,inSlice/resolution.x,index/slice);
}
fn positionToCoord(p:vec3f,lo:vec3f,hi:vec3f,resolution:vec3u)->vec3u{
 return clamp(vec3u(saturate((p-lo)/(hi-lo))*vec3f(resolution)),vec3u(0u),resolution-vec3u(1u));
}`,
)

/** The volume's parameters at binding 0 of group 0: the programs that bind them first list it (the raster,
 *  whose group 0 is the instance's, declares its own). */
export const VOXEL_PARAMS_WGSL = wgslBlock(
  'HAIR_VOXEL_PARAMS_WGSL',
  [VOXEL_COMMON_WGSL],
  '@group(0) @binding(0) var<uniform> params:VoxelParams;',
)

/** A box of six whole numbers (`HAIR_AABB_PRECISION_SCALE` to the metre) of `buffer`, the `index`-th, as
 *  floats: the low corner then the high one. */
const readBoxWgsl = (name: string, buffer: string) =>
  wgslBlock(
    `HAIR_VOXEL_READ_BOX(${name})`,
    [VOXEL_COMMON_WGSL],
    `fn ${name}(index:u32)->array<vec3f,2>{
 let at=index*6u;
 return array<vec3f,2>(
  vec3f(f32(${buffer}[at]),f32(${buffer}[at+1u]),f32(${buffer}[at+2u]))/PRECISION,
  vec3f(f32(${buffer}[at+3u]),f32(${buffer}[at+4u]),f32(${buffer}[at+5u]))/PRECISION);
}`,
  )

const readMacroBox = readBoxWgsl('readMacroBox', 'macroAabb')
const readAlignedBox = readBoxWgsl('readAlignedBox', 'alignedAabb')
const readGroupBox = readBoxWgsl('readGroupBox', 'groupAabb')

/** The args of one dispatch: a macro group's count of workgroups on x, one on y and z. */
const writeArgs = () => `fn writeArgs(slot:u32,x:u32,z:u32){writeIndirectArgs(slot,x,1u,z);}`

/**
 * THE PAGE INDEX OF EACH MACRO GROUP, in one workgroup of a thread each. A group's box (the bounds pass's)
 * is cut in pages of a page's width of voxels, its voxel being the larger of the bounds pass's and the
 * adaptive size the last image left (or the least width the settings name, when the allocation is not
 * adaptive); the groups' indices follow each other in the order of the groups, a group that does not fit
 * the room of the index getting none. What is written: each group's resolution in pages with its offset in
 * the index, the box snapped up to whole pages, and the dispatch over its pages.
 */
export const ALLOCATE_PAGE_INDEX_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> macroAabb:array<i32>;
@group(0) @binding(2) var<storage,read> macroVoxelSize:array<f32>;
@group(0) @binding(3) var<storage,read> gpuVoxelSize:array<f32>;
@group(0) @binding(4) var<storage,read_write> alignedAabb:array<i32>;
@group(0) @binding(5) var<storage,read_write> pageIndexResolution:array<vec4u>;
@group(0) @binding(6) var<storage,read_write> allocationArgs:array<u32>;
${writeArgs()}
var<workgroup> pageIndexOffsets:array<u32,${MAX_MACRO_GROUPS}>;
@compute @workgroup_size(${MAX_MACRO_GROUPS}) fn hairVoxelAllocatePageIndex(@builtin(local_invocation_index) owner:u32){
 var lo=vec3f(3.4e38);
 var hi=vec3f(-3.4e38);
 var pageWorldSize=params.cpuPageWorldSize;
 var valid=owner<params.macroGroupCount;
 if(valid){
  let supports=((params.supportMask>>owner)&1u)!=0u;
  let box=readMacroBox(owner);
  lo=box[0];
  hi=box[1];
  let voxelSize=quantizeVoxelSize(select(max(gpuVoxelSize[0],macroVoxelSize[owner]),params.cpuVoxelWorldSize,params.useCpuVoxelSize!=0u));
  pageWorldSize=voxelSize*f32(params.pageResolution);
  if(any(lo>hi)||!supports){
   lo=vec3f(0.0);
   hi=vec3f(0.0);
   valid=false;
  }
 }
 var resolution=vec3u(0u);
 if(valid){
  resolution=vec3u(ceil((hi-lo)/pageWorldSize));
  hi=vec3f(resolution)*pageWorldSize+lo;
 }
 pageIndexOffsets[owner]=resolution.x*resolution.y*resolution.z;
 workgroupBarrier();
 if(owner==0u){
  var fits=true;
  var offset=0u;
  for(var group=0u;group<params.macroGroupCount;group++){
   let count=pageIndexOffsets[group];
   fits=fits&&(offset+count<=params.totalPageIndexCount);
   pageIndexOffsets[group]=select(INVALID_PAGE,offset,fits);
   offset+=count;
  }
 }
 workgroupBarrier();
 let offset=pageIndexOffsets[owner];
 valid=valid&&offset!=INVALID_PAGE;
 if(!valid){
  pageIndexResolution[owner]=vec4u(0u);
  writeArgs(owner,0u,1u);
  return;
 }
 pageIndexResolution[owner]=vec4u(resolution,offset);
 let at=owner*6u;
 let snappedLo=vec3i(lo*PRECISION);
 let snappedHi=vec3i(hi*PRECISION);
 for(var axis=0u;axis<3u;axis++){
  alignedAabb[at+axis]=snappedLo[axis];
  alignedAabb[at+3u+axis]=snappedHi[axis];
 }
 writeArgs(owner,(resolution.x*resolution.y*resolution.z+${HAIR_VOXEL_ALLOCATE_THREADS - 1}u)/${HAIR_VOXEL_ALLOCATE_THREADS}u,1u);
}`,
  [VOXEL_PARAMS_WGSL, readMacroBox, indirectArgsWgsl('allocationArgs')],
)

/**
 * THE PAGES THE INSTANCES TOUCH: a workgroup for each instance a macro group lists (the bounds pass's
 * list), its threads marking, in the macro group's page index, the pages its box crosses. The macro group
 * that lists the instance is found in the entries; a page marked holds a 1.
 */
export const MARK_VALID_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> groupAabb:array<i32>;
@group(0) @binding(2) var<storage,read> alignedAabb:array<i32>;
@group(0) @binding(3) var<storage,read> pageIndexResolution:array<vec4u>;
@group(0) @binding(4) var<storage,read_write> pageIndex:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read> entries:array<vec4u>;
@group(0) @binding(6) var<storage,read> registered:array<u32>;
@compute @workgroup_size(${HAIR_VOXEL_MARK_THREADS}) fn hairVoxelMarkValid(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_index) lane:u32){
 let listed=block.x;
 var owner=INVALID_PAGE;
 for(var entry=0u;entry<params.entryCount;entry++){
  let e=entries[entry];
  if(listed>=e.y&&listed<e.y+e.z){owner=e.x;}
 }
 if(owner>=params.macroGroupCount||((params.supportMask>>owner)&1u)==0u){return;}
 let located=pageIndexResolution[owner];
 let resolution=located.xyz;
 if(any(resolution==vec3u(0u))){return;}
 let macroBox=readAlignedBox(owner);
 if(any(macroBox[0]>=macroBox[1])){return;}
 let box=readGroupBox(registered[listed]);
 if(any(box[0]>=box[1])){return;}
 let first=positionToCoord(box[0],macroBox[0],macroBox[1],resolution);
 let last=positionToCoord(box[1],macroBox[0],macroBox[1],resolution);
 let span=last-first+vec3u(1u);
 let count=span.x*span.y*span.z;
 // A box that spans absurdly many pages (a degenerate one) marks none.
 if(count>10000u){return;}
 for(var at=lane;at<count;at+=${HAIR_VOXEL_MARK_THREADS}u){
  atomicOr(&pageIndex[coordToIndex(first+indexToCoord(at,span),resolution,located.w)],1u);
 }
}`,
  [VOXEL_PARAMS_WGSL, readAlignedBox, readGroupBox],
)

/**
 * THE PAGES, ALLOCATED: for each macro group (a dispatch of its own, over the pages of its index), the
 * pages marked take the next free page of the volume, counted for the whole volume and for the group; one
 * the volume has no room for gets none (its entry is invalid). The page index then holds the page, the
 * volume's page holds its place in the index, and the allocated pages of the group hold their coordinates
 * in the index with the group's number (invalid for a page left without room). `which` is the group.
 */
export const ALLOCATE_PAGES_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> pageIndexResolution:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> pageIndex:array<u32>;
@group(0) @binding(3) var<storage,read_write> counter:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> pageToPageIndex:array<u32>;
@group(0) @binding(5) var<storage,read_write> pageIndexCoord:array<u32>;
@group(0) @binding(6) var<uniform> which:vec4u;
var<workgroup> localCounter:atomic<u32>;
var<workgroup> groupBase:array<u32,2>;
@compute @workgroup_size(${HAIR_VOXEL_ALLOCATE_THREADS}) fn hairVoxelAllocatePages(@builtin(local_invocation_index) lane:u32,@builtin(global_invocation_id) id:vec3u){
 if(lane==0u){
  atomicStore(&localCounter,0u);
  groupBase[0]=0u;
  groupBase[1]=0u;
 }
 workgroupBarrier();
 let owner=which.x;
 let located=pageIndexResolution[owner];
 let resolution=located.xyz;
 let count=resolution.x*resolution.y*resolution.z;
 let gridIndex=id.x+located.w;
 var allocate=false;
 if(id.x<count){allocate=pageIndex[gridIndex]>0u;}
 var rank=0u;
 if(allocate){rank=atomicAdd(&localCounter,1u);}
 workgroupBarrier();
 if(lane==0u){
  let taken=atomicLoad(&localCounter);
  groupBase[0]=atomicAdd(&counter[0],taken);
  groupBase[1]=atomicAdd(&counter[1u+owner],taken);
 }
 workgroupBarrier();
 if(allocate){
  let page=groupBase[0]+rank;
  let inGroup=groupBase[1]+rank;
  let room=page<params.pageCount;
  pageIndex[gridIndex]=select(INVALID_PAGE,page,room);
  if(room){pageToPageIndex[page]=gridIndex;}
  let coord=indexToCoord(id.x,resolution);
  pageIndexCoord[located.w+inGroup]=coord.x|(coord.y<<8u)|(coord.z<<16u)|(select(INVALID_MACRO,owner,room)<<24u);
 }else if(id.x<count){
  pageIndex[gridIndex]=INVALID_PAGE;
 }
}`,
  [VOXEL_PARAMS_WGSL],
)

/**
 * THE NODE OF EACH MACRO GROUP (`HAIR_VOXEL_NODE_WORDS` words): its snapped box, its resolution and offset
 * in the page index, and its voxel's width, the larger of the bounds pass's and the adaptive size (the
 * least width of the settings when the allocation is not adaptive). A thread a group.
 */
export const ADD_NODE_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> alignedAabb:array<i32>;
@group(0) @binding(2) var<storage,read> macroVoxelSize:array<f32>;
@group(0) @binding(3) var<storage,read> pageIndexResolution:array<vec4u>;
@group(0) @binding(4) var<storage,read> gpuVoxelSize:array<f32>;
@group(0) @binding(5) var<storage,read_write> nodes:array<u32>;
@compute @workgroup_size(${MAX_MACRO_GROUPS}) fn hairVoxelAddNode(@builtin(local_invocation_index) owner:u32){
 if(owner>=params.macroGroupCount){return;}
 let box=readAlignedBox(owner);
 let located=pageIndexResolution[owner];
 let size=select(max(gpuVoxelSize[0],macroVoxelSize[owner]),params.cpuVoxelWorldSize,params.useCpuVoxelSize!=0u);
 let at=owner*8u;
 nodes[at]=bitcast<u32>(box[0].x);
 nodes[at+1u]=bitcast<u32>(box[0].y);
 nodes[at+2u]=bitcast<u32>(box[0].z);
 nodes[at+3u]=(located.x&0xFFu)|((located.y&0xFFu)<<8u)|((located.z&0xFFu)<<16u);
 nodes[at+4u]=bitcast<u32>(box[1].x);
 nodes[at+5u]=bitcast<u32>(box[1].y);
 nodes[at+6u]=bitcast<u32>(box[1].z);
 nodes[at+7u]=(located.w&0x1FFFFFu)|(packVoxelSize(size)<<21u);
}`,
  [VOXEL_PARAMS_WGSL, readAlignedBox],
)

/**
 * THE DISPATCHES OVER THE ALLOCATED PAGES: one over all of them (slot 0) and one over each macro group's
 * (the slot after), `HAIR_VOXEL_PAGE_GROUP[0]` voxels by `[1]` pages a workgroup.
 */
export const ADD_INDIRECT_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> counter:array<u32>;
@group(0) @binding(2) var<storage,read_write> voxelArgs:array<u32>;
${writeArgs()}
fn writePages(slot:u32,pages:u32){
 let voxels=params.pageResolution*params.pageResolution*params.pageResolution;
 writeArgs(slot,(voxels+${HAIR_VOXEL_PAGE_GROUP[0] - 1}u)/${HAIR_VOXEL_PAGE_GROUP[0]}u,(pages+${HAIR_VOXEL_PAGE_GROUP[1] - 1}u)/${HAIR_VOXEL_PAGE_GROUP[1]}u);
}
@compute @workgroup_size(${MAX_MACRO_GROUPS}) fn hairVoxelAddIndirect(@builtin(local_invocation_index) owner:u32){
 if(owner==0u){writePages(0u,counter[0]);}
 if(owner<params.macroGroupCount){writePages(1u+owner,counter[1u+owner]);}
}`,
  [VOXEL_PARAMS_WGSL, indirectArgsWgsl('voxelArgs')],
)

/**
 * THE VOXEL SIZE FOR THE NEXT IMAGE, from the pages this one asked for. The pages the volume holds
 * (`cpuAllocatedPages`) against those the groups asked for: more asked, the size grows by the cube root
 * of the ratio (with the margin `correctionThreshold`); fewer asked and the size above the least one,
 * it shrinks toward it at `correctionSpeed`; else it is the least. Rounded, held to the range of sizes.
 */
export const FEEDBACK_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> counter:array<u32>;
@group(0) @binding(2) var<storage,read> currentSize:array<f32>;
@group(0) @binding(3) var<storage,read_write> nextSize:array<f32>;
fn roundSize(size:f32)->f32{return floor(size*100000.0+0.5)*0.00001;}
@compute @workgroup_size(1) fn hairVoxelFeedback(){
 let current=roundSize(currentSize[0]);
 let asked=f32(counter[0]);
 let held=f32(params.cpuAllocatedPages);
 let ratio=pow(max(asked/(held*params.correctionThreshold),0.0),1.0/3.0);
 var next=params.cpuVoxelWorldSize;
 if(counter[0]>params.cpuAllocatedPages){
  next=current*ratio;
 }else if(counter[0]<params.cpuAllocatedPages&&current>params.cpuVoxelWorldSize){
  next=max(params.cpuVoxelWorldSize,mix(current,current*ratio,params.correctionSpeed));
 }
 nextSize[0]=roundSize(clamp(roundSize(next),params.minVoxelSize,params.maxVoxelSize));
}`,
  [VOXEL_PARAMS_WGSL],
)

/**
 * THE CLEAR OF THE PAGES' FIRST LEVEL: the allocated pages are the first of the volume, so the voxels
 * of the pages up to the count are zeroed, `HAIR_VOXEL_PAGE_GROUP[0]` voxels by `[1]` pages a workgroup
 * (the other levels are written whole by the levels' pass).
 */
export const CLEAR_PAGES_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> counter:array<u32>;
@group(0) @binding(2) var<storage,read_write> voxels:array<u32>;
@compute @workgroup_size(${HAIR_VOXEL_PAGE_GROUP[0]},1,${HAIR_VOXEL_PAGE_GROUP[1]}) fn hairVoxelClearPages(@builtin(global_invocation_id) id:vec3u){
 let perPage=params.pageResolution*params.pageResolution*params.pageResolution;
 if(id.z<counter[0]&&id.x<perPage){voxels[id.z*params.pageStride+id.x]=0u;}
}`,
  [VOXEL_PARAMS_WGSL],
)
