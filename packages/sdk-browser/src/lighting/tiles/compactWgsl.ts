import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';

/** Lanes of a column's workgroup: a batch of lights, one each. */
export const GRID_LANES = 64;
/** Runs a column keeps between its two walks: a column of more kept lights tests the rest again. */
const GRID_CACHE = 512;
const SLICES = LIGHT_SETTINGS.gridSlices;

/**
 * The lists of a column's cells (#1369), in two walks of its kept lights, each a batch of 64 at a
 * time, one per lane, every lane in step: a lane marks the light's bit in the mask of each slice of
 * its run, then each lane counts — in the first walk — or writes — in the second — the slices it
 * owns, bit after bit, so each list holds its lights in increasing order, as a single-thread loop.
 * Between the walks, lane zero takes the column's room in the view's pool (`./pool.ts`, one atomic
 * add) and deals it out slice by slice; no room left: the overflow is raised and every cell of the
 * column walks every light (`TILE_NO_SLICE`). The first walk keeps the runs it found, `GRID_CACHE`
 * at most: the second walk reads them, and tests again only the lights past them.
 */
export const GRID_COMPACT_WGSL = `
const LANES:u32=${GRID_LANES}u;
const CACHE:u32=${GRID_CACHE}u;
/** A run \`first | last << 16\` that holds no slice. */
const EMPTY_RUN:u32=0xffffu;
/** \`resume\` before a batch past the cache's room. */
const ALL_CACHED:u32=0xffffffffu;
struct TilePool{start:u32,capacity:u32,head:atomic<u32>,overflow:atomic<u32>,}
@group(0) @binding(3) var<storage,read_write> pool:TilePool;
/** The batch: each lane's light, its shadow slot in the high bit, and its run. */
var<workgroup> chunk:array<vec2u,LANES>;
/** Per slice, the lanes of the batch whose run holds it; the lanes holding a shadow slot. */
var<workgroup> masks:array<atomic<u32>,${2 * SLICES}u>;
var<workgroup> slotted:array<atomic<u32>,2>;
var<workgroup> keptLanes:array<atomic<u32>,2>;
/** Per slice, its count (the high bit: a shadow slot listed), then where its list is written. */
var<workgroup> counts:array<u32,GRID_SLICES>;
var<workgroup> cursor:array<u32,GRID_SLICES>;
var<workgroup> cache:array<vec2u,CACHE>;
/** The runs cached; the first light the cache does not hold; whether the second walk writes. */
var<workgroup> cached:u32;
var<workgroup> resume:u32;
var<workgroup> room:u32;
/** The entry of light \`index\`: its run in this column, \`EMPTY_RUN\` when it meets no cell. A
 *  directional light reaches every cell. */
fn entryOf(column:Column,index:u32)->vec2u{
 let light=lights.items[index];
 let slot=select(0u,TILE_SHADOWED,light.params.y>-1.0);
 if(isSun(light)){return vec2u(index|slot,(GRID_SLICES-1u)<<16u);}
 let centre=light.positionRange.xyz-view.origin.xyz;
 if(!sphereInColumn(column,centre,light.positionRange.w)){return vec2u(index,EMPTY_RUN);}
 let run=lightRun(column,centre,light.positionRange.w);
 if(run.x>run.y){return vec2u(index,EMPTY_RUN);}
 return vec2u(index|slot,run.x|(run.y<<16u));
}
/** Lane \`lane\` puts its entry in the batch and its bit in the masks of its run's slices. */
fn markEntry(lane:u32,entry:vec2u){
 chunk[lane]=entry;
 let first=entry.y&0xffffu;let last=entry.y>>16u;
 if(first>last){return;}
 let bit=1u<<(lane%32u);let word=lane/32u;
 atomicOr(&keptLanes[word],bit);
 if((entry.x&TILE_SHADOWED)!=0u){atomicOr(&slotted[word],bit);}
 for(var slice=first;slice<=last;slice++){atomicOr(&masks[slice*2u+word],bit);}
}
/** The slices lane \`lane\` owns count the batch's lights in their mask, then clear it. */
fn countSlices(lane:u32){
 let shadow=vec2u(atomicLoad(&slotted[0]),atomicLoad(&slotted[1]));
 for(var slice=lane;slice<GRID_SLICES;slice+=LANES){
  let mask=vec2u(atomicLoad(&masks[slice*2u]),atomicLoad(&masks[slice*2u+1u]));
  counts[slice]+=countOneBits(mask.x)+countOneBits(mask.y);
  if(any((mask&shadow)!=vec2u(0u))){counts[slice]|=TILE_SHADOWED;}
  atomicStore(&masks[slice*2u],0u);atomicStore(&masks[slice*2u+1u],0u);
 }
}
/** The slices lane \`lane\` owns write the batch's lights of their mask in increasing order. */
fn writeSlices(lane:u32){
 for(var slice=lane;slice<GRID_SLICES;slice+=LANES){
  var at=cursor[slice];
  for(var word=0u;word<2u;word++){
   var mask=atomicLoad(&masks[slice*2u+word]);
   while(mask!=0u){
    tiles[at]=chunk[word*32u+firstTrailingBit(mask)].x&~TILE_SHADOWED;
    at++;mask&=mask-1u;
   }
   atomicStore(&masks[slice*2u+word],0u);
  }
  cursor[slice]=at;
 }
}
/** Lane \`lane\`'s entry, in order among the batch's kept ones, into the cache at \`cached\`. */
fn cacheEntry(lane:u32,entry:vec2u){
 let kept=vec2u(atomicLoad(&keptLanes[0]),atomicLoad(&keptLanes[1]));
 let below=(1u<<(lane%32u))-1u;
 let rank=select(countOneBits(kept.x&below),countOneBits(kept.x)+countOneBits(kept.y&below),lane>=32u);
 if((entry.y&0xffffu)<=(entry.y>>16u)){cache[cached+rank]=entry;}
}
/** Lane zero: the column's room in the pool, dealt out slice by slice. A column with no light
 *  takes none; \`room\` says whether the second walk has lists to write. */
fn takeRoom(){
 var total=0u;
 for(var slice=0u;slice<GRID_SLICES;slice++){total+=counts[slice]&~TILE_SHADOWED;}
 var at=0u;var fits=true;
 if(total>0u){
  // The count of what was asked stops at half the word's range: it never wraps back into room.
  at=0xffffffffu;
  if(atomicLoad(&pool.head)<0x80000000u){at=atomicAdd(&pool.head,total);}
  fits=at<pool.capacity&&total<=pool.capacity-at;
  if(!fits){atomicStore(&pool.overflow,1u);}
 }
 room=u32(fits&&total>0u);
 var next=pool.start+at;
 for(var slice=0u;slice<GRID_SLICES;slice++){
  cursor[slice]=select(TILE_NO_SLICE,next,fits);
  next+=counts[slice]&~TILE_SHADOWED;
 }
}`;
