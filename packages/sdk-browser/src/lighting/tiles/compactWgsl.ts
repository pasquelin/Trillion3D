import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { LANE_SCAN_WGSL } from '../../gpu/core/laneScanWgsl.ts'

/** Lanes of a column's workgroup: a batch of lights, one each. */
export const GRID_LANES = 64
/** Runs a column keeps between its two walks: a column of more kept lights tests the rest again. */
const GRID_CACHE = 512
const SLICES = LIGHT_SETTINGS.gridSlices

/**
 * The lists of a column's cells (#1369), in two walks of its kept lights, each a batch of 64 at a
 * time, one per lane, every lane in step: a lane marks the light's bit in the mask of each slice of
 * its run — in one mask for all of them when the run holds every slice, a sun's —, then each lane
 * counts — in the first walk — or writes — in the second — the slices it owns, bit after bit, so
 * each list holds its lights in increasing order, as a single-thread loop. Between the walks, the
 * lanes scan their runs of slices (the engine's `laneRun` and `laneScan`) and lane zero takes the
 * column's room in the view's pool (`./pool.ts`, one atomic add), which each lane then deals out
 * over its run; no room left: the overflow is raised and every cell of the column walks every
 * light (`TILE_NO_SLICE`). The first walk keeps the runs it found, `GRID_CACHE` at most: the second
 * walk reads them, and tests again only the lights past them. All of it is integer: the counts,
 * cursors and lists are the single-thread loop's (`gridColumn.test.ts`).
 */
export const GRID_COMPACT_WGSL = `${LANE_SCAN_WGSL}
const LANES:u32=${GRID_LANES}u;
const CACHE:u32=${GRID_CACHE}u;
/** A run \`first | last << 16\` that holds no slice; the one that holds them all. */
const EMPTY_RUN:u32=0xffffu;
const FULL_RUN:u32=${(SLICES - 1) << 16}u;
/** \`resume\` before a batch past the cache's room. */
const ALL_CACHED:u32=0xffffffffu;
struct TilePool{start:u32,capacity:u32,head:atomic<u32>,overflow:atomic<u32>,}
@group(0) @binding(3) var<storage,read_write> pool:TilePool;
/** The batch: each lane's light, its shadow slot in the high bit, and its run. */
var<workgroup> chunk:array<vec2u,LANES>;
/** Per slice, the lanes of the batch whose run holds it; the lanes holding a shadow slot. */
var<workgroup> masks:array<atomic<u32>,${2 * SLICES}u>;
/** The lanes whose entry holds every slice: their bit stands for every slice's mask. */
var<workgroup> full:array<atomic<u32>,2>;
var<workgroup> slotted:array<atomic<u32>,2>;
var<workgroup> keptLanes:array<atomic<u32>,2>;
/** Per slice, its count (the high bit: a shadow slot listed), then where its list is written. */
var<workgroup> counts:array<u32,GRID_SLICES>;
var<workgroup> cursor:array<u32,GRID_SLICES>;
var<workgroup> cache:array<vec2u,CACHE>;
/** The runs cached; the first light the cache does not hold. */
var<workgroup> cached:u32;
var<workgroup> resume:u32;
/** What the first walk leaves, read at once: whether the second walk writes, the runs cached,
 *  the first light past them, and where the column's room starts in the pool — \`TILE_NO_SLICE\`
 *  without room, never a start, which lies inside a buffer the device binds. */
var<workgroup> walked:vec4u;
/** The entry of light \`index\`: its run in this column, \`EMPTY_RUN\` when it meets no cell. A
 *  directional light reaches every cell. */
fn entryOf(column:Column,index:u32)->vec2u{
 let light=lights.items[index];
 let slot=select(0u,TILE_SHADOWED,light.params.y>-1.0);
 if(isSun(light)){return vec2u(index|slot,FULL_RUN);}
 let centre=light.positionRange.xyz-view.origin.xyz;
 if(!sphereInColumn(column,centre,light.positionRange.w)){return vec2u(index,EMPTY_RUN);}
 let run=lightRun(column,centre,light.positionRange.w);
 if(run.x>run.y){return vec2u(index,EMPTY_RUN);}
 return vec2u(index|slot,run.x|(run.y<<16u));
}
/** Lane \`lane\` puts its entry in the batch and its bit in the masks of its run's slices, or in
 *  \`full\` for a run that holds them all. Its bit there follows its entry in \`chunk\`: it is set
 *  or cleared only when that changes, every lane marking every batch. */
fn markEntry(lane:u32,entry:vec2u){
 let bit=1u<<(lane%32u);let word=lane/32u;
 let whole=entry.y==FULL_RUN;
 if(whole!=(chunk[lane].y==FULL_RUN)){
  if(whole){atomicOr(&full[word],bit);}else{atomicAnd(&full[word],~bit);}
 }
 chunk[lane]=entry;
 let first=entry.y&0xffffu;let last=entry.y>>16u;
 if(first>last){return;}
 atomicOr(&keptLanes[word],bit);
 if((entry.x&TILE_SHADOWED)!=0u){atomicOr(&slotted[word],bit);}
 if(whole){return;}
 for(var slice=first;slice<=last;slice++){atomicOr(&masks[slice*2u+word],bit);}
}
/** The slices lane \`lane\` owns count the batch's lights in their mask, then clear it. */
fn countSlices(lane:u32){
 let shadow=vec2u(atomicLoad(&slotted[0]),atomicLoad(&slotted[1]));
 let whole=vec2u(atomicLoad(&full[0]),atomicLoad(&full[1]));
 for(var slice=lane;slice<GRID_SLICES;slice+=LANES){
  let mask=whole|vec2u(atomicLoad(&masks[slice*2u]),atomicLoad(&masks[slice*2u+1u]));
  counts[slice]+=countOneBits(mask.x)+countOneBits(mask.y);
  if(any((mask&shadow)!=vec2u(0u))){counts[slice]|=TILE_SHADOWED;}
  atomicStore(&masks[slice*2u],0u);atomicStore(&masks[slice*2u+1u],0u);
 }
}
/** The slices lane \`lane\` owns write the batch's lights of their mask in increasing order. */
fn writeSlices(lane:u32){
 let whole=vec2u(atomicLoad(&full[0]),atomicLoad(&full[1]));
 for(var slice=lane;slice<GRID_SLICES;slice+=LANES){
  var at=cursor[slice];
  for(var word=0u;word<2u;word++){
   var mask=whole[word]|atomicLoad(&masks[slice*2u+word]);
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
/** The room of the slices before lane \`lane\`'s run \`span\` (\`laneRun\`): the runs' totals,
 *  scanned over the lanes. Every lane calls it, from uniform control flow; \`laneSums[LANES-1]\`
 *  is then the column's total. */
fn roomBefore(lane:u32,span:vec2u)->u32{
 var sum=0u;
 for(var slice=span.x;slice<span.y;slice++){sum+=counts[slice]&~TILE_SHADOWED;}
 return laneScan(lane,sum)-sum;
}
/** Lane zero, after \`roomBefore\`: the column's room in the pool. A column with no light takes
 *  none; \`walked.x\` says whether the second walk has lists to write. */
fn takeRoom(){
 let total=laneSums[LANES-1u];
 var at=0u;var fits=true;
 if(total>0u){
  // The count of what was asked stops at half the word's range: it never wraps back into room.
  at=0xffffffffu;
  if(atomicLoad(&pool.head)<0x80000000u){at=atomicAdd(&pool.head,total);}
  fits=at<pool.capacity&&total<=pool.capacity-at;
  if(!fits){atomicStore(&pool.overflow,1u);}
 }
 walked.x=u32(fits&&total>0u);
 walked.w=select(TILE_NO_SLICE,pool.start+at,fits);
}
/** A lane deals the column's room, from \`start\`, out over its run \`span\`, \`before\` past it. */
fn dealRoom(span:vec2u,before:u32,start:u32){
 var next=start+before;
 for(var slice=span.x;slice<span.y;slice++){
  cursor[slice]=select(TILE_NO_SLICE,next,start!=TILE_NO_SLICE);
  next+=counts[slice]&~TILE_SHADOWED;
 }
}`
