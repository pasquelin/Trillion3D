import { WORKGROUP_THREADS, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { LANE_SCAN_WGSL, laneRunSum } from '../../gpu/core/laneScanWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { bitMask, bitWord, highHalf, lowBits, lowHalf } from '../../../../math/src/wgsl/integer.ts'
import { lightUndrawn } from '../direct/lightReachWgsl.ts'

/** Runs a column keeps between its two walks: a column of more kept lights tests the rest again. */
const GRID_CACHE = 512

/** The constants, bindings and what the workgroup shares. */
const compactDeclsText = (slices: number) => `${wgslConsts({
  CACHE: GRID_CACHE,
  COLUMN_SLICES: slices,
  LANE_WORDS: bitWords(WORKGROUP_THREADS),
})}
/** A run \`first | last << 16\` that holds no slice; the one that holds them all. */
const EMPTY_RUN:u32=0xffffu;
const FULL_RUN:u32=${(slices - 1) << 16}u;
/** \`resume\` before a batch past the cache's room. */
const ALL_CACHED:u32=0xffffffffu;
struct TilePool{start:u32,capacity:u32,head:atomic<u32>,overflow:atomic<u32>,}
@group(0) @binding(3) var<storage,read_write> pool:TilePool;
/** The batch: each lane's light, its shadow slot in the high bit, and its run. */
var<workgroup> chunk:array<vec2u,WORKGROUP_THREADS>;
/** Per slice, the lanes of the batch whose run holds it; the lanes holding a shadow slot. */
var<workgroup> masks:array<atomic<u32>,${bitWords(WORKGROUP_THREADS) * slices}u>;
/** The lanes whose entry holds every slice: their bit stands for every slice's mask. */
var<workgroup> full:array<atomic<u32>,LANE_WORDS>;
var<workgroup> slotted:array<atomic<u32>,LANE_WORDS>;
var<workgroup> keptLanes:array<atomic<u32>,LANE_WORDS>;
/** Per slice, its count (the high bit: a shadow slot listed), then where its list is written. */
var<workgroup> counts:array<u32,COLUMN_SLICES>;
var<workgroup> cursor:array<u32,COLUMN_SLICES>;
/** Per slice, where its list ends: the words the column was granted may stop it short. */
var<workgroup> ends:array<u32,COLUMN_SLICES>;
/** The words of the pool the column was granted, of the ones it asked. */
var<workgroup> granted:u32;
var<workgroup> cache:array<vec2u,CACHE>;
/** The runs cached; the first light the cache does not hold. */
var<workgroup> cached:u32;
var<workgroup> resume:u32;
/** What the first walk leaves, read at once: whether the second walk writes, the runs cached,
 *  the first light past them, and where the column's room starts in the pool. */
var<workgroup> walked:vec4u;`

/** The batch's entries, marked in the masks and counted slice by slice. */
const COMPACT_MARK_TEXT = `/** The entry of light \`index\`: its run in this column, cut at the column's last visible slice
 *  (\`Column.reach\`), \`EMPTY_RUN\` when it meets no cell or the view leaves it out (\`lightUndrawn\`: the bit
 *  of its kind word the CPU set, too small on the screen or past its draw distance, \`lightDrawn\`). A directional light reaches every
 *  cell, \`FULL_RUN\` where none is cut. */
fn entryOf(column:Column,index:u32)->vec2u{
 let light=directLights.items[index];
 let slot=select(0u,TILE_SHADOWED,light.params.y>-1.0);
 if(isSun(light)){return vec2u(index|slot,column.reach<<16u);}
 if(lightUndrawn(light)){return vec2u(index,EMPTY_RUN);}
 let centre=light.positionRange.xyz-view.origin.xyz;
 if(!sphereInColumn(column,centre,light.positionRange.w)){return vec2u(index,EMPTY_RUN);}
 let run=lightRun(column,centre,light.positionRange.w);
 let last=min(run.y,column.reach);
 if(run.x>last){return vec2u(index,EMPTY_RUN);}
 return vec2u(index|slot,run.x|(last<<16u));
}
/** Lane \`lane\` puts its entry in the batch and its bit in the masks of its run's slices, or in
 *  \`full\` for a run that holds them all. Its bit there follows its entry in \`chunk\`: it is set
 *  or cleared only when that changes, every lane marking every batch. */
fn markEntry(lane:u32,entry:vec2u){
 let bit=bitMask(lane);let word=bitWord(lane);
 let whole=entry.y==FULL_RUN;
 if(whole!=(chunk[lane].y==FULL_RUN)){
  if(whole){atomicOr(&full[word],bit);}else{atomicAnd(&full[word],~bit);}
 }
 chunk[lane]=entry;
 let first=lowHalf(entry.y);let last=highHalf(entry.y);
 if(first>last){return;}
 atomicOr(&keptLanes[word],bit);
 if((entry.x&TILE_SHADOWED)!=0u){atomicOr(&slotted[word],bit);}
 if(whole){return;}
 for(var slice=first;slice<=last;slice++){atomicOr(&masks[slice*LANE_WORDS+word],bit);}
}
/** The lanes whose entry holds every slice, read once by a lane before its slices. */
fn wholeLanes()->array<u32,LANE_WORDS>{
 var whole:array<u32,LANE_WORDS>;
 for(var word=0u;word<LANE_WORDS;word++){whole[word]=atomicLoad(&full[word]);}
 return whole;
}
/** The slices lane \`lane\` owns count the batch's lights in their mask, then clear it. */
fn countSlices(lane:u32){
 let whole=wholeLanes();
 var shadow:array<u32,LANE_WORDS>;
 for(var word=0u;word<LANE_WORDS;word++){shadow[word]=atomicLoad(&slotted[word]);}
 for(var slice=lane;slice<COLUMN_SLICES;slice+=WORKGROUP_THREADS){
  var count=0u;var shadowed=0u;
  for(var word=0u;word<LANE_WORDS;word++){
   let mask=whole[word]|atomicLoad(&masks[slice*LANE_WORDS+word]);
   count+=countOneBits(mask);
   shadowed|=mask&shadow[word];
   atomicStore(&masks[slice*LANE_WORDS+word],0u);
  }
  counts[slice]+=count;
  if(shadowed!=0u){counts[slice]|=TILE_SHADOWED;}
 }
}`

/** The second walk's write of the lists, up to what the column was granted. */
const COMPACT_WRITE_TEXT = `/** The slices lane \`lane\` owns write the batch's lights of their mask in increasing order. */
fn writeSlices(lane:u32){
 let whole=wholeLanes();
 for(var slice=lane;slice<COLUMN_SLICES;slice+=WORKGROUP_THREADS){
  var at=cursor[slice];
  let end=ends[slice];
  for(var word=0u;word<LANE_WORDS;word++){
   var mask=whole[word]|atomicLoad(&masks[slice*LANE_WORDS+word]);
   while(mask!=0u){
    if(at<end){
     tiles[at]=chunk[word*32u+firstTrailingBit(mask)].x&~TILE_SHADOWED;
     at++;
    }
    mask&=mask-1u;
   }
   atomicStore(&masks[slice*LANE_WORDS+word],0u);
  }
  cursor[slice]=at;
 }
}`

/** The cache of the first walk's runs, and the batch's bookkeeping. */
const COMPACT_CACHE_TEXT = `/** Lane \`lane\`'s entry, in order among the batch's kept ones, into the cache at \`cached\`. */
fn cacheEntry(lane:u32,entry:vec2u){
 let word=bitWord(lane);
 var rank=countOneBits(atomicLoad(&keptLanes[word])&lowBits(lane%32u));
 for(var w=0u;w<word;w++){rank+=countOneBits(atomicLoad(&keptLanes[w]));}
 if(lowHalf(entry.y)<=highHalf(entry.y)){cache[cached+rank]=entry;}
}
/** The lanes of the batch whose entry meets the column. */
fn keptCount()->u32{
 var kept=0u;
 for(var word=0u;word<LANE_WORDS;word++){kept+=countOneBits(atomicLoad(&keptLanes[word]));}
 return kept;
}
/** Lane zero, after a batch: no lane kept nor slotted for the next. */
fn clearBatch(){
 for(var word=0u;word<LANE_WORDS;word++){atomicStore(&keptLanes[word],0u);atomicStore(&slotted[word],0u);}
}`

/** The room of the slices before a lane's run, scanned over the lanes. */
const COMPACT_SCAN_TEXT = `/** The room of the slices before lane \`lane\`'s run \`span\` (\`laneRun\`): the runs' totals,
 *  scanned over the lanes. Every lane calls it, from uniform control flow;
 *  \`laneSums[WORKGROUP_THREADS-1]\` is then the column's total. */
fn roomBefore(lane:u32,span:vec2u)->u32{
 ${laneRunSum('slice', 'span', 'counts[slice]&~TILE_SHADOWED')}
 return laneScan(lane,sum)-sum;
}`

/** The column's room in the pool taken by lane zero, and its deal over the lanes. */
const COMPACT_ROOM_TEXT = `/** Lane zero, after \`roomBefore\`: the column's room in the pool. A column with no light takes
 *  none; \`walked.x\` says whether the second walk has lists to write. */
fn takeRoom(){
 let total=laneSums[WORKGROUP_THREADS-1u];
 var at=0u;
 var kept=0u;
 if(total>0u){
  // The count of what was asked stops at half the word's range: it never wraps back into room.
  at=0xffffffffu;
  if(atomicLoad(&pool.head)<0x80000000u){at=atomicAdd(&pool.head,total);}
  if(at<pool.capacity){kept=min(total,pool.capacity-at);}else{at=pool.capacity;}
  if(kept<total){atomicStore(&pool.overflow,1u);}
 }
 granted=kept;
 walked.x=u32(kept>0u);
 walked.w=pool.start+at;
}
/** A lane deals the column's room, from \`start\`, out over its run \`span\`, \`before\` past it: each
 *  slice its lists' words up to what was granted, its count cut to them. */
fn dealRoom(span:vec2u,before:u32,start:u32){
 var offset=before;
 for(var slice=span.x;slice<span.y;slice++){
  let held=counts[slice]&~TILE_SHADOWED;
  let take=select(0u,min(held,granted-offset),offset<granted);
  let first=start+min(offset,granted);
  cursor[slice]=first;ends[slice]=first+take;
  counts[slice]=(counts[slice]&TILE_SHADOWED)|take;
  offset+=held;
 }
}`

/**
 * The lists of a column's cells, in two walks of its kept lights, each a batch of
 * `WORKGROUP_THREADS` at a time, one per lane, every lane in step: a lane marks the light's bit in
 * the mask of each slice of its run — in one mask for all of them when the run holds every slice, a
 * sun's —, then each lane counts — in the first walk — or writes — in the second — the slices it
 * owns, bit after bit, so each list holds its lights in increasing order, as a single-thread loop.
 * Between the walks, the lanes scan their runs of slices (the engine's `laneRun` and `laneScan`)
 * and lane zero takes the column's room in the view's pool (`./pool.ts`, one atomic add), which
 * each lane then deals out over its run. The grid keeps what the pool has left: the column keeps its
 * first lights in cell order, each cell its lights in light order up to its share, the rest dropped
 * and the overflow raised, as the reference's cell writer drops a light once its links are used up.
 * The first walk keeps the runs it found, `GRID_CACHE` at most: the second walk reads them, and tests
 * again only the lights past them. All of it is integer: the counts, cursors and lists are the
 * single-thread loop's (`gridColumn.test.ts`).
 *
 * A column holds `slices` cells (`COLUMN_SLICES`): the depth slices (`gridSlices`).
 * A lane mask is `LANE_WORDS` words, as many as the batch's lanes need, whatever
 * `WORKGROUP_THREADS` occupancy tunes it to.
 */
export const gridCompactWgsl = (slices: number) =>
  wgslBlock(
    `gridCompactWgsl(${slices})`,
    [
      LANE_SCAN_WGSL,
      WORKGROUP_THREADS_WGSL,
      lowHalf,
      highHalf,
      bitMask,
      bitWord,
      lowBits,
      lightUndrawn,
    ],
    `${compactDeclsText(slices)}
${COMPACT_MARK_TEXT}
${COMPACT_WRITE_TEXT}
${COMPACT_CACHE_TEXT}
${COMPACT_SCAN_TEXT}
${COMPACT_ROOM_TEXT}`,
  )
