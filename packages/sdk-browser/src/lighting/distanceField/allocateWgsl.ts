import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import {
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  WORKGROUP_THREADS,
  indirectArgsWgsl,
} from '../../gpu/dispatch/grid.ts'
import { squaredDistanceBetweenBoxes } from './aabbWgsl.ts'
import { CONTROL } from './clipmapBlock.ts'
import { clipmapCommonWgsl } from './clipmapCommonWgsl.ts'
import { meshFieldWgsl } from './meshFieldWgsl.ts'

/**
 * THE ALLOCATION OF THE PAGES, and the lists it keeps.
 *
 * `allocatePages` runs a group of 64 threads for each page tile of an update: the threads share the
 * placements of the page's cell of the culling grid, each asks how far the surface of every one it can
 * reach lies from the page's centre, and the nearest distance is reduced across the group. A page
 * whose centre lies within the page's radius of the influence range of a surface holds something
 * and is allocated if it is not — the last page of the free list, the list's allocator counting
 * down, nothing where it has run out —, its tile listed for the composition; a page that holds nothing
 * is given back to the list of pages returned. With a static clipmap under it, a page with none of its
 * own shows the static one's in the table the programs read.
 *
 * The free list is made once (`initPageFreeList`: every page, the allocator at the pages' count);
 * after the update, `setupReturnArgs` sizes the return to it (and holds the allocator at 0 or more,
 * where requests ran past the end) and `returnToFreeList` appends the pages returned. The
 * `setup…Args` entries turn a count into the arguments of an indirect dispatch (the composition's, a group a
 * eighth of a page, and the coverage's, a group a page).
 */

const CONSTANTS = wgslConsts({
  CONTROL_COUNTERS: CONTROL.counters,
  COUNTERS_PER_CLIPMAP: CONTROL.countersPerClipmap,
  CONTROL_UPDATED: CONTROL.updated,
})

/** The entries. */
export const ALLOCATE_ENTRIES = {
  allocate: 'allocatePages',
  init: 'initPageFreeList',
  updateArgs: 'setupUpdateArgs',
  composeArgs: 'setupComposeArgs',
  returnArgs: 'setupReturnArgs',
  returnPages: 'returnToFreeList',
} as const

const LANES = WORKGROUP_THREADS

const REDUCE = [32, 16, 8, 4, 2]
  .map(
    (
      half,
    ) => ` if(thread<${half}u){minDistances[thread]=min(minDistances[thread],minDistances[thread+${half}u]);}
 workgroupBarrier();`,
  )
  .join('\n')

/** `allocatePages`: the scene in group 0, the pass's own bindings in group 1. */
export const ALLOCATE_SHADER = wgslProgram(
  `${CONSTANTS}
@group(1) @binding(1) var<storage,read_write> tiles:array<u32>;
@group(1) @binding(2) var pageTable:texture_storage_3d<r32uint,read_write>;
@group(1) @binding(3) var combinedTable:texture_storage_3d<r32uint,write>;
@group(1) @binding(4) var parentTable:texture_3d<u32>;
@group(1) @binding(5) var<storage,read_write> control:array<atomic<u32>>;
@group(1) @binding(6) var<storage,read_write> lists:array<u32>;
@group(1) @binding(7) var<storage,read> cullGrid:array<u32>;
var<workgroup> minDistances:array<f32,64>;
fn nearestSurface(grid:vec3u,thread:u32)->f32{
 let translation=DfVec3(clip.translationHigh,clip.translationLow);
 let centre=vec3f(grid)*clip.pageToPageScale+clip.pageToPageBias;
 let world=dfSubtractFromFloat(centre,translation);
 let influenceMax=clip.influenceRadius+clip.pageWorldRadius+GDF_PAGE_BORDER;
 let header=cullCellHeader(grid);
 let count=cullGrid[header];
 let start=cullGrid[header+1u];
 var nearest=influenceMax;
 for(var k=thread;k<count;k+=64u){
  let object=cullGrid[clip.cullArray+start+k];
  let bounds=loadDfObjectBounds(object);
  let apart=squaredDistanceBetweenBoxes(centre,clip.pageWorldExtent,dfToTranslated(bounds.center,translation),bounds.boxExtent);
  if(apart<clip.influenceRadius*clip.influenceRadius){
   nearest=min(nearest,distanceToNearestSurfaceForObject(loadDfObjectData(object),world,influenceMax));
  }
 }
 return nearest;
}
fn takeFreePage()->u32{
 let before=bitcast<i32>(atomicAdd(&control[GDF_FREE_ALLOCATOR],0xFFFFFFFFu));
 var taken=GDF_INVALID_PAGE;
 if(before>0){taken=lists[u32(before-1)];}
 return taken;
}
@compute @workgroup_size(${LANES}) fn ${ALLOCATE_ENTRIES.allocate}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(num_workgroups) n:vec3u){
 let thread=local.x;
 let grid=unpackTile(tiles[clip.tiles.x+group.x+group.y*n.x]);
 minDistances[thread]=nearestSurface(grid,thread);
 workgroupBarrier();
${REDUCE}
 if(thread!=0u){return;}
 let nearest=min(minDistances[0],minDistances[1]);
 let holds=nearest+clip.pageWorldRadius>=-clip.influenceRadius&&nearest-clip.pageWorldRadius<=clip.influenceRadius;
 let coord=pageTableCoord(grid);
 var page=unpackGdfPage(textureLoad(pageTable,coord).x);
 if(holds&&!page.valid){
  let taken=takeFreePage();
  if(taken!=GDF_INVALID_PAGE){
   page=GdfPage(taken,true,false);
   textureStore(pageTable,coord,vec4u(packGdfPage(page)));
  }
 }else if(!holds&&page.valid){
  let at=atomicAdd(&control[GDF_RETURN_ALLOCATOR],1u);
  lists[clip.maxPages+at]=page.index;
  page.valid=false;
  textureStore(pageTable,coord,vec4u(packGdfPage(page)));
 }
 if((clip.flags&FLAG_PARENT)!=0u){
  var combined=page;
  if(!combined.valid){combined=unpackGdfPage(textureLoad(parentTable,coord,0).x);}
  textureStore(combinedTable,coord,vec4u(packGdfPage(combined)));
 }
 if(page.valid){
  let at=atomicAdd(&control[CONTROL_COUNTERS+clip.packed*COUNTERS_PER_CLIPMAP+2u],1u);
  atomicAdd(&control[CONTROL_UPDATED],1u);
  tiles[clip.tiles.y+at]=packTile(grid);
 }
}`,
  [meshFieldWgsl(0), clipmapCommonWgsl(1, 0), squaredDistanceBetweenBoxes],
)

/** The list entries, in group 0. */
export const LISTS_SHADER = wgslProgram(
  `${CONSTANTS}
@group(0) @binding(1) var<storage,read_write> control:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> lists:array<u32>;
@group(0) @binding(3) var<storage,read_write> args:array<u32>;
fn writeArgs(at:u32,groups:u32){
 let grid=groupGrid(groups);
 writeIndirectArgs(at,grid.x,grid.y,1u);
}
fn countersAt()->u32{return CONTROL_COUNTERS+clip.packed*COUNTERS_PER_CLIPMAP;}
@compute @workgroup_size(${LANES}) fn ${ALLOCATE_ENTRIES.init}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(id,n,${LANES}u);
 if(index<clip.maxPages){lists[index]=clip.maxPages-1u-index;}
 if(index==0u){atomicStore(&control[GDF_FREE_ALLOCATOR],clip.maxPages);}
}
@compute @workgroup_size(1) fn ${ALLOCATE_ENTRIES.updateArgs}(){
 writeArgs(clip.args,atomicLoad(&control[countersAt()]));
 writeArgs(clip.args+3u,atomicLoad(&control[countersAt()+1u]));
}
@compute @workgroup_size(1) fn ${ALLOCATE_ENTRIES.composeArgs}(){
 let composed=atomicLoad(&control[countersAt()+2u]);
 writeArgs(clip.args+6u,composed*GDF_PAGE_GROUPS);
 writeArgs(clip.args+12u,composed);
}
@compute @workgroup_size(1) fn ${ALLOCATE_ENTRIES.returnArgs}(){
 writeArgs(clip.args+9u,(atomicLoad(&control[GDF_RETURN_ALLOCATOR])+${LANES - 1}u)/${LANES}u);
 let free=bitcast<i32>(atomicLoad(&control[GDF_FREE_ALLOCATOR]));
 atomicStore(&control[GDF_FREE_ALLOCATOR],bitcast<u32>(max(free,0)));
}
@compute @workgroup_size(${LANES}) fn ${ALLOCATE_ENTRIES.returnPages}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(id,n,${LANES}u);
 if(index<atomicLoad(&control[GDF_RETURN_ALLOCATOR])){
  let at=atomicAdd(&control[GDF_FREE_ALLOCATOR],1u);
  lists[at]=lists[clip.maxPages+index];
 }
}`,
  [
    clipmapCommonWgsl(0, 0),
    FLAT_INDEX_WGSL,
    GROUP_GRID_WGSL,
    indirectArgsWgsl('args', { words: '1u' }),
  ],
)
