import { WORKGROUP_THREADS, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { bitMask, bitWord, highHalf, lowHalf } from '../../../../math/src/wgsl/integer.ts'
import { lightUndrawn } from '../direct/lightReachWgsl.ts'
import { LANE_SCAN_WGSL } from '../../gpu/core/laneScanWgsl.ts'

/** Words of a link of a cell's chain: the light it lists, then the link that was the cell's head
 *  before it. */
export const LIGHT_LINK_STRIDE = 2

/** The constants, bindings and what the workgroup shares. */
const compactDeclsText = (slices: number) => `${wgslConsts({
  COLUMN_SLICES: slices,
  LANE_WORDS: bitWords(WORKGROUP_THREADS),
  LIGHT_LINK_STRIDE,
})}
/** A run \`first | last << 16\` that holds no slice; the one that holds them all. */
const EMPTY_RUN:u32=0xffffu;
const FULL_RUN:u32=${(slices - 1) << 16}u;
/** The end of a cell's chain of links. */
const LINK_NONE:u32=0xffffffffu;
/** The count of entries asked stops at half the word's range: it never wraps back under the capacity. */
const ASKED_LIMIT:u32=0x80000000u;
/** The view's pool: where the lists start, the entries it holds, the entries asked of it and the
 *  entries the lists hold. The links have the pool's capacity, and so have the lists, which are
 *  never longer than the links that made them; when the links run short, the entries asked last are
 *  lost and \`links\` still counts them (more than \`head\`: the pool overflowed). */
struct TilePool{start:u32,capacity:u32,links:atomic<u32>,head:atomic<u32>,}
@group(0) @binding(3) var<storage,read_write> pool:TilePool;
/** The links of every cell's chain, \`LIGHT_LINK_STRIDE\` words each. */
@group(0) @binding(4) var<storage,read_write> culledLightLinks:array<u32>;
/** The batch: each lane's light, its shadow slot in the high bit, and its run. */
var<workgroup> chunk:array<vec2u,WORKGROUP_THREADS>;
/** Per slice, the lanes of the batch whose run holds it. */
var<workgroup> masks:array<atomic<u32>,${bitWords(WORKGROUP_THREADS) * slices}u>;
/** The lanes whose entry holds every slice: their bit stands for every slice's mask. */
var<workgroup> full:array<atomic<u32>,LANE_WORDS>;
/** Per slice, its count (the high bit: a shadow slot listed), and the link its chain ends on. */
var<workgroup> counts:array<u32,COLUMN_SLICES>;
var<workgroup> heads:array<u32,COLUMN_SLICES>;
/** The first link the batch's lights take, and the first word of the column's lists in the pool. */
var<workgroup> linkBase:u32;
var<workgroup> listBase:u32;`

/** The batch's entries, marked in the masks. */
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
 if(first>last||whole){return;}
 for(var slice=first;slice<=last;slice++){atomicOr(&masks[slice*LANE_WORDS+word],bit);}
}
/** The lanes whose entry holds every slice, read once by a lane before its slices. */
fn wholeLanes()->array<u32,LANE_WORDS>{
 var whole:array<u32,LANE_WORDS>;
 for(var word=0u;word<LANE_WORDS;word++){whole[word]=atomicLoad(&full[word]);}
 return whole;
}`

/** The injection: the batch's lights put in the cells. */
const COMPACT_INJECT_TEXT = `/** The lights of the batch the cells of the run \`span\` take: the bits of their masks. */
fn batchLights(span:vec2u)->u32{
 let whole=wholeLanes();
 var sum=0u;
 for(var slice=span.x;slice<span.y;slice++){
  for(var word=0u;word<LANE_WORDS;word++){
   sum=sum+countOneBits(whole[word]|atomicLoad(&masks[slice*LANE_WORDS+word]));
  }
 }
 return sum;
}
/** The links before those of lane \`lane\`'s run \`span\` in the batch: the lanes' counts, scanned.
 *  Every lane calls it, from uniform control flow; \`laneSums[WORKGROUP_THREADS-1]\` is then the
 *  batch's total. */
fn linksBefore(lane:u32,span:vec2u)->u32{
 let sum=batchLights(span);
 return laneScan(lane,sum)-sum;
}
/** Lane zero, after \`linksBefore\`: the batch's entries counted in the pool in one atomic add, and
 *  the first link they take; past the count's limit they are asked of nothing, and land past the
 *  capacity. */
fn reserveLinks(){
 let total=laneSums[WORKGROUP_THREADS-1u];
 var base=pool.capacity;
 if(total>0u&&atomicLoad(&pool.links)<ASKED_LIMIT){base=atomicAdd(&pool.links,total);}
 linkBase=base;
}
/** The cells of the run \`span\` take the batch's lights of their mask in increasing order, then
 *  clear the mask: link \`first\` and those after it are theirs, in the cells' order. A light chains
 *  its link before its cell's head, as a single thread's loop over the lights would; a link past the
 *  pool's capacity is not written and its light is dropped. The count and the cell's shadow bit
 *  follow what was kept. */
fn pushLinks(span:vec2u,first:u32){
 let whole=wholeLanes();
 let capacity=pool.capacity;
 var link=first;
 for(var slice=span.x;slice<span.y;slice++){
  for(var word=0u;word<LANE_WORDS;word++){
   var mask=whole[word]|atomicLoad(&masks[slice*LANE_WORDS+word]);
   atomicStore(&masks[slice*LANE_WORDS+word],0u);
   while(mask!=0u){
    let entry=chunk[word*32u+firstTrailingBit(mask)].x;
    if(link<capacity){
     culledLightLinks[link*LIGHT_LINK_STRIDE]=entry&~TILE_SHADOWED;
     culledLightLinks[link*LIGHT_LINK_STRIDE+1u]=heads[slice];
     heads[slice]=link;
     counts[slice]=(counts[slice]+1u)|(entry&TILE_SHADOWED);
    }
    link++;
    mask&=mask-1u;
   }
  }
 }
}
/** The same batch for cells with \`perCell\` words of their own in the pool, the column's first being
 *  cell \`columnCell\` of the grid: a cell keeps its first lights up to its share and to the pool's
 *  capacity. The batch's entries were counted by \`reserveLinks\`. */
fn pushOwn(span:vec2u,columnCell:u32,perCell:u32){
 let whole=wholeLanes();
 let capacity=pool.capacity;
 let start=pool.start;
 for(var slice=span.x;slice<span.y;slice++){
  for(var word=0u;word<LANE_WORDS;word++){
   var mask=whole[word]|atomicLoad(&masks[slice*LANE_WORDS+word]);
   atomicStore(&masks[slice*LANE_WORDS+word],0u);
   while(mask!=0u){
    let entry=chunk[word*32u+firstTrailingBit(mask)].x;
    let held=counts[slice]&~TILE_SHADOWED;
    let at=(columnCell+slice)*perCell+held;
    if(held<perCell&&at<capacity){
     tiles[start+at]=entry&~TILE_SHADOWED;
     counts[slice]=(counts[slice]+1u)|(entry&TILE_SHADOWED);
    }
    mask&=mask-1u;
   }
  }
 }
}`

/** The compaction: a cell's chain written as its list. */
const COMPACT_OUTPUT_TEXT = `/** The chain that starts at link \`first\`, \`count\` links long, written as the list at \`start\`: the
 *  chain runs from the last light listed to the first, so it is written from the list's end. */
fn outputReversedLinks(first:u32,count:u32,start:u32){
 var link=first;
 var index=0u;
 while(link!=LINK_NONE&&index<count){
  tiles[start+count-index-1u]=culledLightLinks[link*LIGHT_LINK_STRIDE];
  link=culledLightLinks[link*LIGHT_LINK_STRIDE+1u];
  index++;
 }
}
/** The lists of the column's cells in the pool: the words they hold, scanned over the lanes' runs
 *  \`span\`. Every lane calls it, from uniform control flow, like \`linksBefore\`. */
fn listsBefore(lane:u32,span:vec2u)->u32{
 var sum=0u;
 for(var slice=span.x;slice<span.y;slice++){sum=sum+(counts[slice]&~TILE_SHADOWED);}
 return laneScan(lane,sum)-sum;
}
/** Lane zero, after \`listsBefore\`: the column's list words counted in the pool by one atomic add,
 *  and, for chains of links, taken there. */
fn reserveLists(){
 let total=laneSums[WORKGROUP_THREADS-1u];
 if(total>0u){listBase=atomicAdd(&pool.head,total);}
}
/** The cells of the run \`span\`, once every batch is injected: each writes its chain as its list,
 *  from word \`listAt\` of the buffer, the lists following one another, and its record at \`records\`
 *  — its count and where its list starts. A cell with no light keeps the pool's start. With
 *  \`perCell\` set the lists were written where each cell's words are, and only the records are. */
fn emitSlices(span:vec2u,columnCell:u32,records:u32,perCell:u32,listAt:u32){
 var at=listAt;
 for(var slice=span.x;slice<span.y;slice++){
  let held=counts[slice]&~TILE_SHADOWED;
  var start=pool.start;
  if(perCell>0u){
   start+=(columnCell+slice)*perCell;
  }else if(held>0u){
   start=at;
   outputReversedLinks(heads[slice],held,start);
   at+=held;
  }
  let record=records+(columnCell+slice)*TILE_STRIDE;
  tiles[record]=counts[slice];
  tiles[record+1u]=start;
 }
}
`

/**
 * The lists of a column's cells, by a chain of links per cell. The column's lights go through in
 * batches of `WORKGROUP_THREADS`, one per lane: a lane marks the light's bit in the mask of each slice
 * of its run — in one mask for all of them when the run holds every slice, a sun's. Each lane then
 * takes the lights of the masks of a run of slices; the lanes scan their counts so the whole batch
 * asks the pool's link counter (`pool.links`) once, for as many links as it has lights, and a cell
 * takes its links in order. Each light writes itself and the cell's previous head in its link and
 * becomes the head. A link past the pool's capacity is not written and its light is dropped; the
 * counter still counts it. Once every batch is in, the lanes scan the words their cells hold, one add
 * to the list counter (`pool.head`) gives the column its place, and each chain is written from the
 * list's end back to its start, so each list holds its lights in increasing order. The pool has as
 * many list words as links, and a list is never longer than its chain: it never overflows; when
 * links run short, the entries asked last are lost, `links` counting more than `head`.
 * With the cell's words set (the setting `lightGridLinkedLists` off) the cell has a share of its own
 * in the pool and keeps its first lights, the counters counting the entries asked and kept.
 *
 * A column holds `slices` cells (`COLUMN_SLICES`): the depth slices (`gridSlices`). A lane mask is
 * `LANE_WORDS` words, as many as the batch's lanes need, whatever `WORKGROUP_THREADS` occupancy tunes
 * it to. All of it is integer: the counts and lists are the single-thread loop's (`gridColumn.test.ts`).
 */
export const gridCompactWgsl = (slices: number) =>
  wgslBlock(
    `gridCompactWgsl(${slices})`,
    [LANE_SCAN_WGSL, WORKGROUP_THREADS_WGSL, lowHalf, highHalf, bitMask, bitWord, lightUndrawn],
    `${compactDeclsText(slices)}
${COMPACT_MARK_TEXT}
${COMPACT_INJECT_TEXT}
${COMPACT_OUTPUT_TEXT}`,
  )
