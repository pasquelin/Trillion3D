import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS } from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { squaredDistanceBetweenBoxes } from './aabbWgsl.ts'
import { CONTROL } from './clipmapBlock.ts'
import { clipmapCommonWgsl } from './clipmapCommonWgsl.ts'
import { OBJECT_FLAGS } from './layout.ts'
import { meshFieldWgsl } from './meshFieldWgsl.ts'

/**
 * THE CULLING OF THE PLACEMENTS INTO THE CLIPMAPS, in three passes.
 *
 * `cullObjectsToClipmap` walks the placements once for every clipmap updated: the ones of the kind
 * this cache holds (the static meshes', the movable ones' or all), shown or hidden-but-lighting, that
 * are larger than the clipmap's smallest mesh (or that emit light) and whose box lies within the
 * clipmap's influence range of its box are listed for it, and a clipmap whose placement still has only
 * its coarsest mip is flagged, for the update to be made again once the streaming is done.
 *
 * `buildGridTiles` finds, per cell of the culling grid (a group of 4 × 4 × 4 pages), the pages
 * that an update region reaches: first which regions reach the cell, then which of those reach each
 * page; the cell is listed if any page is, and each page that is. A region that asks for it is
 * grown by the influence range.
 *
 * `cullObjectsToGrid` lists, per listed cell, the clipmap's placements within the influence range of
 * the cell.
 */

/** The block of the culling of placements to clipmaps. */
export const CULL_BLOCK = fieldLayout('DfCull', [
  ['acceptMobility', 'u32'],
  ['clipmaps', 'u32'],
  ['objectStride', 'u32'],
  ['packedBase', 'u32'],
  ['translationHigh', 'vec3f'],
  ['padB', 'f32'],
  ['translationLow', 'vec3f'],
  ['padC', 'f32'],
] as const)

/** The words of the objects buffer before the lists: one count for each clipmap of a cache. */
export const OBJECT_COUNTS = GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS

/** The entries of the three passes. */
export const CULL_ENTRIES = {
  clipmap: 'cullObjectsToClipmap',
  tiles: 'buildGridTiles',
  grid: 'cullObjectsToGrid',
} as const

const LANES = WORKGROUP_THREADS
const CONSTANTS = wgslConsts({
  OBJECT_COUNTS,
  FLAG_MOVING: OBJECT_FLAGS.oftenMoving,
  FLAG_EMISSIVE: OBJECT_FLAGS.emissive,
  FLAG_VISIBLE: OBJECT_FLAGS.visible,
  FLAG_HIDDEN_LIGHTING: OBJECT_FLAGS.affectsIndirectLightingHidden,
  CONTROL_COUNTERS: CONTROL.counters,
  CONTROL_PENDING: CONTROL.pending,
})

/** `cullObjectsToClipmap`: the scene in group 0, the pass's own bindings in group 1. */
export const CULL_CLIPMAP_SHADER = wgslProgram(
  `${CONSTANTS}
${CULL_BLOCK.wgsl}
@group(1) @binding(0) var<uniform> cull:DfCull;
@group(1) @binding(1) var<storage,read> packedClipmaps:array<vec4u>;
@group(1) @binding(2) var<storage,read_write> objects:array<atomic<u32>>;
@group(1) @binding(3) var<storage,read_write> control:array<atomic<u32>>;
struct PackedClipmap{centre:vec3f,radiusThreshold:f32,extent:vec3f,influenceSq:f32,index:u32,recache:bool}
fn loadPackedClipmap(rank:u32)->PackedClipmap{
 let at=(cull.packedBase+rank)*3u;
 let a=packedClipmaps[at];
 let b=packedClipmaps[at+1u];
 let c=packedClipmaps[at+2u];
 return PackedClipmap(bitcast<vec3f>(a.xyz),bitcast<f32>(a.w),bitcast<vec3f>(b.xyz),bitcast<f32>(b.w),c.x,c.y!=0u);
}
@compute @workgroup_size(${LANES}) fn ${CULL_ENTRIES.clipmap}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(id,n,${LANES}u);
 if(index>=dfScene.objects){return;}
 let bounds=loadDfObjectBounds(index);
 let moving=bounds.flags&FLAG_MOVING;
 let kind=cull.acceptMobility==2u||moving==cull.acceptMobility;
 let shown=(bounds.flags&FLAG_VISIBLE)!=0u||(bounds.flags&FLAG_HIDDEN_LIGHTING)!=0u;
 if(!kind||!shown){return;}
 let centre=dfToTranslated(bounds.center,DfVec3(cull.translationHigh,cull.translationLow));
 for(var rank=0u;rank<cull.clipmaps;rank++){
  let clipmap=loadPackedClipmap(rank);
  if(bounds.sphereRadius>clipmap.radiusThreshold||(bounds.flags&FLAG_EMISSIVE)!=0u){
   let apart=squaredDistanceBetweenBoxes(clipmap.centre,clipmap.extent,centre,bounds.boxExtent);
   if(apart<clipmap.influenceSq){
    let at=atomicAdd(&objects[rank],1u);
    atomicStore(&objects[OBJECT_COUNTS+rank*cull.objectStride+at],index);
    if(clipmap.recache&&dfAssetMip(loadDfObjectData(index).asset,0u).numMips==1u){
     atomicStore(&control[CONTROL_PENDING+clipmap.index],1u);
    }
   }
  }
 }
}`,
  [meshFieldWgsl(0), squaredDistanceBetweenBoxes, FLAT_INDEX_WGSL],
)

/** `buildGridTiles`, in group 0. */
export const GRID_TILES_SHADER = wgslProgram(
  `${CONSTANTS}
@group(0) @binding(1) var<storage,read> updateBounds:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> tiles:array<u32>;
@group(0) @binding(3) var<storage,read_write> control:array<atomic<u32>>;
const MAX_CULLED:u32=511u;
var<workgroup> culledBounds:array<u32,511>;
var<workgroup> culledCount:atomic<u32>;
var<workgroup> cellMask:array<atomic<u32>,2>;
fn markCell(local:vec3u){
 let bit=local.x+(local.y+local.z*4u)*4u;
 atomicOr(&cellMask[bit>>5u],1u<<(bit&31u));
}
fn cellMarked(local:vec3u)->bool{
 let bit=local.x+(local.y+local.z*4u)*4u;
 return (atomicLoad(&cellMask[bit>>5u])&(1u<<(bit&31u)))!=0u;
}
fn boundBox(b:u32)->vec4f{return updateBounds[(clip.boundsBase+b)*2u];}
fn boundExtent(b:u32)->vec3f{return updateBounds[(clip.boundsBase+b)*2u+1u].xyz;}
fn boundRadiusSq(b:u32)->f32{return select(0.0,clip.influenceRadiusSq,boundBox(b).w>0.0);}
@compute @workgroup_size(4,4,4) fn ${CULL_ENTRIES.tiles}(@builtin(workgroup_id) group:vec3u,@builtin(global_invocation_id) page:vec3u,@builtin(local_invocation_id) local:vec3u){
 let thread=local.x+(local.y+local.z*4u)*4u;
 if(thread==0u){
  atomicStore(&cellMask[0],0u);
  atomicStore(&cellMask[1],0u);
  atomicStore(&culledCount,0u);
 }
 workgroupBarrier();
 if(all(group<clip.cullGrid)){
  let cellCentre=vec3f(group)*clip.cullToCentreScale+clip.cullToCentreBias;
  for(var b=thread;b<clip.updateBounds;b+=64u){
   let apart=squaredDistanceBetweenBoxes(boundBox(b).xyz,boundExtent(b),cellCentre,clip.cullTileExtent);
   if(apart<=boundRadiusSq(b)){
    let at=atomicAdd(&culledCount,1u);
    if(at<MAX_CULLED){culledBounds[at]=b;}
   }
  }
 }
 workgroupBarrier();
 if(all(page<clip.pageGrid)){
  let pageCentre=vec3f(page)*clip.pageToPageScale+clip.pageToPageBias;
  let count=min(atomicLoad(&culledCount),MAX_CULLED);
  for(var k=0u;k<count;k++){
   let b=culledBounds[k];
   let apart=squaredDistanceBetweenBoxes(boundBox(b).xyz,boundExtent(b),pageCentre,clip.pageTileExtent);
   if(apart<=boundRadiusSq(b)){
    markCell(local);
    break;
   }
  }
 }
 workgroupBarrier();
 let countersAt=CONTROL_COUNTERS+clip.packed*${CONTROL.countersPerClipmap}u;
 if(thread==0u&&(atomicLoad(&cellMask[0])|atomicLoad(&cellMask[1]))!=0u){
  let at=atomicAdd(&control[countersAt+1u],1u);
  tiles[clip.tiles.z+at]=packTile(group);
 }
 if(cellMarked(local)){
  let at=atomicAdd(&control[countersAt],1u);
  tiles[clip.tiles.x+at]=packTile(page);
 }
}`,
  [clipmapCommonWgsl(0, 0), squaredDistanceBetweenBoxes],
)

/** `cullObjectsToGrid`: the scene in group 0, the pass's own bindings in group 1. */
export const CULL_GRID_SHADER = wgslProgram(
  `${CONSTANTS}
@group(1) @binding(1) var<storage,read> objects:array<u32>;
@group(1) @binding(2) var<storage,read> tiles:array<u32>;
@group(1) @binding(3) var<storage,read_write> control:array<atomic<u32>>;
@group(1) @binding(4) var<storage,read_write> cullGrid:array<u32>;
var<workgroup> cellCount:atomic<u32>;
var<workgroup> cellStart:u32;
fn objectInCell(object:u32,cellCentre:vec3f)->bool{
 let bounds=loadDfObjectBounds(object);
 let centre=dfToTranslated(bounds.center,DfVec3(clip.translationHigh,clip.translationLow));
 return squaredDistanceBetweenBoxes(cellCentre,clip.cullTileExtent,centre,bounds.boxExtent)<=clip.influenceRadiusSq;
}
@compute @workgroup_size(256) fn ${CULL_ENTRIES.grid}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(num_workgroups) n:vec3u){
 let thread=local.x;
 let cell=unpackTile(tiles[clip.tiles.z+group.x+group.y*n.x]);
 let linear=(cell.z*clip.cullGrid.y+cell.y)*clip.cullGrid.x+cell.x;
 if(thread==0u){atomicStore(&cellCount,0u);}
 workgroupBarrier();
 let cellCentre=vec3f(cell)*clip.cullToCentreScale+clip.cullToCentreBias;
 let inside=all(cell<clip.cullGrid);
 let objectsHere=objects[clip.packed];
 if(inside){
  for(var k=thread;k<objectsHere;k+=256u){
   if(objectInCell(objects[OBJECT_COUNTS+clip.packed*clip.objectStride+k],cellCentre)){atomicAdd(&cellCount,1u);}
  }
 }
 workgroupBarrier();
 if(thread==0u){
  let count=atomicLoad(&cellCount);
  cellStart=atomicAdd(&control[CONTROL_COUNTERS+clip.packed*${CONTROL.countersPerClipmap}u+3u],count);
  cullGrid[clip.cullHeader+linear*2u]=count;
  cullGrid[clip.cullHeader+linear*2u+1u]=cellStart;
  atomicStore(&cellCount,0u);
 }
 workgroupBarrier();
 if(inside){
  for(var k=thread;k<objectsHere;k+=256u){
   let object=objects[OBJECT_COUNTS+clip.packed*clip.objectStride+k];
   if(objectInCell(object,cellCentre)){
    let at=atomicAdd(&cellCount,1u);
    cullGrid[clip.cullArray+cellStart+at]=object;
   }
  }
 }
}`,
  [meshFieldWgsl(0), clipmapCommonWgsl(1, 0), squaredDistanceBetweenBoxes],
)
