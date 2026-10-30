/**
 * THE GLOBAL FIELD'S PAGE STATISTICS (`pageStats.ts`): two kernels over the field's reads (group 0, `globalDistanceFieldReadWgsl`) and
 * the statistics' words (group 1).
 *
 *   stats    array<atomic<u32>>   0 the pages of the clipmaps in use, 1 those of them holding no surface, 2 the pages composited this image, 3 the free pages
 *   control  array<u32>           the field's control words (`CONTROL`): the free list's allocator, then the counters of each clipmap rank
 */
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import {
  GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION,
} from '../../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { CONTROL } from '../clipmapBlock.ts'
import { globalDistanceFieldReadWgsl } from '../globalReadWgsl.ts'

/** The words of the statistics buffer, in the order the kernels write them. */
export const PAGE_STATS_WORDS = 4
/** The threads along each axis of a group of the pages kernel. */
export const PAGE_STATS_GROUP = 4

export const PAGE_STATS_ENTRIES = { pages: 'gdfPageStats', totals: 'gdfPageTotals' } as const

/** The pages kernel counts the pages of every clipmap that are in use, and the ones with no voxel strictly between 0 and 1 (nothing near a surface) in them, the border
 *  voxels left out by clamping the read inside the page; the totals kernel adds the pages every rank composited this image and copies the free list's allocator. */
export const PAGE_STATS_WGSL = wgslProgram(
  `${wgslConsts({
    STATS_PAGES: 0,
    STATS_EMPTY: 1,
    STATS_UPDATED: 2,
    STATS_FREE: 3,
    CONTROL_FREE_ALLOCATOR: CONTROL.freeAllocator,
    CONTROL_COUNTERS: CONTROL.counters,
    COUNTERS_PER_CLIPMAP: CONTROL.countersPerClipmap,
    COMPOSED_COUNTER: 2,
    PAGE_VOXELS: GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION,
    MAX_CLIPMAPS: GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS,
  })}
@group(1) @binding(0) var<storage,read_write> stats:array<atomic<u32>>;
@group(1) @binding(1) var<storage,read> control:array<u32>;
@compute @workgroup_size(${PAGE_STATS_GROUP},${PAGE_STATS_GROUP},${PAGE_STATS_GROUP}) fn ${PAGE_STATS_ENTRIES.pages}(@builtin(global_invocation_id) id:vec3u){
 let along=gdfView.pagesAlong;
 if(id.x>=along||id.y>=along||id.z>=along*gdfView.clipmaps){return;}
 let packed=textureLoad(gdfPageTable,vec3i(id),0).x;
 if(packed==GDF_INVALID_PAGE){return;}
 atomicAdd(&stats[STATS_PAGES],1u);
 let page=packed&0x00FFFFFFu;
 let last=f32(PAGE_VOXELS)-1.0;
 var filled=false;
 for(var z=0u;z<PAGE_VOXELS&&!filled;z++){
  for(var y=0u;y<PAGE_VOXELS&&!filled;y++){
   for(var x=0u;x<PAGE_VOXELS&&!filled;x++){
    let local=clamp(vec3f(f32(x),f32(y),f32(z))+0.5,vec3f(1.0),vec3f(last))-0.5;
    let value=gdfAtlasSample(page,local);
    filled=value>0.0&&value<1.0;
   }
  }
 }
 if(!filled){atomicAdd(&stats[STATS_EMPTY],1u);}
}
@compute @workgroup_size(1) fn ${PAGE_STATS_ENTRIES.totals}(){
 var composed=0u;
 for(var rank=0u;rank<MAX_CLIPMAPS;rank++){
  composed+=control[CONTROL_COUNTERS+rank*COUNTERS_PER_CLIPMAP+COMPOSED_COUNTER];
 }
 atomicStore(&stats[STATS_UPDATED],composed);
 atomicStore(&stats[STATS_FREE],control[CONTROL_FREE_ALLOCATOR]);
}`,
  [globalDistanceFieldReadWgsl(0, 0, false)],
)
