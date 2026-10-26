import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { CACHE_PDF_WORDS } from '../cache/cacheLayout.ts'
import { BOUNCE_ATLAS_FORMAT, TABLE_LANES, TABLE_LAYER, TABLE_WIDTH } from '../atlas.ts'
import { BOUNCE_CELLS_WGSL, BOUNCE_GRID_STRUCTS_WGSL } from '../gridWgsl.ts'
import { PROBE_QUEUE_WORDS, QUEUE_WORD_WGSL } from '../probes/probeQueueWgsl.ts'
import { BOUNCE_GRID } from '../uniform.ts'
import {
  FINISH_BINDINGS as F,
  POOL_ARGS,
  POOL_BINDINGS as B,
  POOL_COST,
  POOL_DISTANCE_BUCKETS,
  POOL_PARAMS,
  POOL_PRIORITY_BUCKETS,
  POOL_QUEUE,
  POOL_SLOT,
  POOL_WORK,
} from './poolLayout.ts'

/** The constants the pool's kernels share: the slot's words, the work buffer's words, the buckets and costs, what the settings bound. */
const POOL_CONSTS = wgslBlock(
  'POOL_CONSTS',
  [WORKGROUP_THREADS_WGSL],
  wgslConsts({
    SLOT_WORDS: POOL_SLOT.words,
    SLOT_OWNER: POOL_SLOT.owner,
    SLOT_CELL: POOL_SLOT.cell,
    SLOT_USED: POOL_SLOT.usedAt,
    SLOT_TRACED: POOL_SLOT.tracedAt,
    SLOT_TRACES: POOL_SLOT.traces,
    SLOT_LEVEL: POOL_SLOT.level,
    W_FREE: POOL_WORK.free,
    W_REFUSED: POOL_WORK.refused,
    W_QUEUED: POOL_WORK.queued,
    W_SPENT: POOL_WORK.spent,
    W_WAITING: POOL_WORK.waiting,
    W_ELIGIBLE: POOL_WORK.eligible,
    W_CUT_UNTRACED: POOL_WORK.cutUntraced,
    W_ROOM_UNTRACED: POOL_WORK.roomUntraced,
    W_CUT_TRACED: POOL_WORK.cutTraced,
    W_ROOM_TRACED: POOL_WORK.roomTraced,
    W_MARKED: POOL_WORK.marked,
    W_LIVE: POOL_WORK.live,
    W_UNFILLED: POOL_WORK.unfilled,
    W_REFRESHING: POOL_WORK.refreshing,
    W_HIGH: POOL_WORK.high,
    W_UNTRACED: POOL_WORK.untraced,
    W_TRACED: POOL_WORK.traced,
    W_STACK: POOL_WORK.stack,
    DISTANCE_BUCKETS: POOL_DISTANCE_BUCKETS,
    PRIORITY_BUCKETS: POOL_PRIORITY_BUCKETS,
    COST_DOWNSAMPLED: POOL_COST.downsampled,
    COST_NORMAL: POOL_COST.normal,
    COST_SUPERSAMPLED: POOL_COST.supersampled,
    QUEUE_ENTRIES: POOL_QUEUE,
    QUEUE_WORDS: PROBE_QUEUE_WORDS,
    KEPT_MARKS: BOUNCE_SETTINGS.probeKeptMarks,
    SETTLED_TRACES: BOUNCE_SETTINGS.settledTraces,
    NO_SLOT: 0xffffffff,
    NONE_BUCKET: 0xffffffff,
    TABLE_WIDTH,
    TABLE_LAYER,
    TABLE_LANES,
  }),
)

/**
 * THE POOL'S STATE, as the kernels read it: the levels' uniform (`bounce`) and the pool's parameters (`pool`), the slots (`slots`, a record of
 * `SLOT_WORDS` words each, `POOL_SLOT`), the table (`table`: an entry a word — the slot plus one that holds the cell in the low sixteen
 * bits, the slot plus one the lit passes read for it in the high sixteen, which a probe takes at its first trace and gives back
 * with its cell), the work buffer (`work`, `POOL_WORK`) and the marks' bitmap (`marks`).
 */
const POOL_STATE = wgslBlock(
  'POOL_STATE',
  [POOL_CONSTS, BOUNCE_GRID_STRUCTS_WGSL, BOUNCE_CELLS_WGSL],
  `${POOL_PARAMS.wgsl}
@group(0) @binding(${B.grid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${B.params}) var<uniform> pool:PoolParams;
@group(0) @binding(${B.slots}) var<storage,read_write> slots:array<u32>;
@group(0) @binding(${B.table}) var<storage,read_write> table:array<u32>;
@group(0) @binding(${B.work}) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(${B.marks}) var<storage,read_write> marks:array<atomic<u32>>;
fn entries()->u32{return bounce.counts.y*bounce.counts.z;}
fn imageRank()->u32{return bounce.frame.z;}
fn slotWord(slot:u32,word:u32)->u32{return slots[slot*SLOT_WORDS+word];}
fn slotCell(slot:u32)->vec3i{
 let at=slot*SLOT_WORDS+SLOT_CELL;
 return bitcast<vec3i>(vec3u(slots[at],slots[at+1u],slots[at+2u]));
}
/** Whether the level holds the cell now: the cube it covers, moved with the eye. */
fn levelHolds(level:u32,cell:vec3i)->bool{
 let base=vec3i(bounce.levels[level].base);
 return all(cell>=base)&&all(cell<base+vec3i(i32(bounce.counts.x)));
}
/** The cell of the entry \`entry\` of a level now: the cell of the level's cube whose remainders modulo the side the entry names. */
fn entryLevel(entry:u32)->u32{return entry/bounce.counts.z;}
fn entryCell(entry:u32)->vec3i{
 let side=bounce.counts.x;
 let level=entryLevel(entry);
 let rest=entry-level*bounce.counts.z;
 let remainder=vec3i(i32(rest%side),i32((rest/side)%side),i32(rest/(side*side)));
 let base=vec3i(bounce.levels[level].base);
 let size=i32(side);
 return base+((remainder-base)%size+vec3i(size))%size;
}
/** What tracing the probe of \`cell\` of \`level\` costs by its distance from the eye: a quarter of a whole map past the downsample distance,
 *  four whole maps within the supersample distance, one else. */
fn probeCost(level:u32,cell:vec3i)->u32{
 let away=probeCellCentre(cell,bounce.levels[level].spacing)-bounce.eye.xyz;
 let squared=dot(away,away);
 return select(select(COST_NORMAL,COST_SUPERSAMPLED,squared<pool.distances.y),COST_DOWNSAMPLED,squared>=pool.distances.x);
}
fn probeCellCentre(cell:vec3i,spacing:f32)->vec3f{return (vec3f(cell)+vec3f(0.5))*spacing;}
/** The bucket of a probe never traced: its level, then the whole cells of its distance from the eye's cell, the farthest bucket the rest. */
fn untracedBucket(level:u32,cell:vec3i)->u32{
 let eye=vec3i(floor(bounce.eye.xyz/bounce.levels[level].spacing));
 let away=length(vec3f(cell-eye));
 return level*DISTANCE_BUCKETS+u32(min(f32(DISTANCE_BUCKETS-1u),floor(away)));
}
/** The bucket of a probe already traced: the log₂ of the images since its trace over its level plus one — held between none and
 *  the last but one —, the sooner the lower. */
fn tracedBucket(level:u32,tracedAt:u32)->u32{
 let importance=f32(max(1u,imageRank()-tracedAt))/f32(level+1u);
 return PRIORITY_BUCKETS-1u-u32(clamp(floor(log2(importance)),0.0,f32(PRIORITY_BUCKETS-2u)));
}
/** Whether the probe of the slot is one never traced; one traced and still short of its updates. */
fn untraced(slot:u32)->bool{return slotWord(slot,SLOT_OWNER)!=0u&&slotWord(slot,SLOT_TRACED)==0u;}
fn refreshing(slot:u32)->bool{
 let traced=slotWord(slot,SLOT_TRACED);
 return slotWord(slot,SLOT_OWNER)!=0u&&traced>0u&&traced<imageRank()&&slotWord(slot,SLOT_TRACES)<SETTLED_TRACES;
}
/** Takes \`cost\` from the room in the work word \`word\` where all of it is left, one thread at a time. */
fn takeRoom(word:u32,cost:u32)->bool{
 var held=atomicLoad(&work[word]);
 var took=false;
 loop{
  if(took||held<cost){break;}
  let taken=atomicCompareExchangeWeak(&work[word],held,held-cost);
  took=taken.exchanged;
  held=taken.old_value;
 }
 return took;
}`,
)

/**
 * The pool's kernels over the slots, the table and the work buffer, one program, dispatched in this order by `pool.ts`:
 *
 * - `clearWork`: the counters, histograms and cuts of the image, zeroed.
 * - `restartProbes`: where the lights changed, the traces every probe took since are forgotten: all are traced again, up to `settledTraces` times.
 * - `releaseProbes`, a thread a slot: the probe whose cell has left its level is given back (its entry cleared, its slot on the stack); in an
 *   image that marks, the probe the marks read keeps its age (the image's rank) and the one unread for `probeKeptMarks` images goes too.
 * - `allocateProbes`, a thread a word of the marks' bitmap: each cell marked that holds no probe takes one from the stack, or, with none
 *   left, is refused (`refused` counts them in all): the cell goes unanswered, and the next level or the sky light answers for it.
 * - `countProbes`, a thread a slot: the probes never traced are counted by level and distance (each in a unit, `eligible` in all, `waiting`
 *   in their cost), the others by priority (each in its cost).
 * - `cutUntraced`: the bucket the queue stops in, among those never traced, and how many of it fit; `spent` begins at the cheapest every
 *   one of them could cost.
 * - `emitUntraced`, a thread a slot: those within the cut are queued, each at its cost — at a quarter of it, whatever the distance, once
 *   what the budget leaves is spent: the first trace of a cell is what lets it answer at all —, published to the table (the lit passes
 *   read a probe once its map is made), and counted as a trace.
 * - `cutTraced`: what the budget leaves after the cost of every probe never traced — none, if nothing —, and the bucket of the others it stops in.
 * - `emitTraced`, a thread a slot: those within the cut that fit the room are queued, the sooner traced before.
 * - `tallyProbes`, a thread a slot: the probes alive, those that hold nothing yet and those short of their updates, counted for the CPU.
 * - `publishTable`, a thread a texel of the table: the entries' slots written, four to a texel, into the published table.
 *
 * The kernels over the slots are dispatched indirectly over `high`, the slots ever given (the stack gives the lowest first, the rest are
 * free), by the arguments `sizeSlots` (`POOL_FINISH_SHADER`) wrote: again after the allocation, the one thing that raises it.
 *
 * A probe is never given a slot for a cell the levels do not hold, and is given back with the cell it left.
 */
export const POOL_SHADER = wgslProgram(
  `@group(0) @binding(${B.queue}) var<storage,read_write> probeQueue:array<u32>;
@group(0) @binding(${B.published}) var publishedOut:texture_storage_2d_array<${BOUNCE_ATLAS_FORMAT},write>;
/** Gives the probe of the slot back: its entry cleared in both halves, its slot on the stack. */
fn giveBack(slot:u32){
 let at=slot*SLOT_WORDS;
 let entry=slots[at+SLOT_OWNER]-1u;
 if((table[entry]&0xffffu)==slot+1u){table[entry]=table[entry]&0xffff0000u;}
 if((table[entry]>>16u)==slot+1u){table[entry]=table[entry]&0xffffu;}
 slots[at+SLOT_OWNER]=0u;
 let top=atomicAdd(&work[W_FREE],1u);
 atomicStore(&work[W_STACK+top],slot);
}
/** The slot on top of the stack, taken; none when the stack is empty. */
fn takeSlot()->u32{
 var held=atomicLoad(&work[W_FREE]);
 var slot=NO_SLOT;
 loop{
  if(slot!=NO_SLOT||held==0u){break;}
  let taken=atomicCompareExchangeWeak(&work[W_FREE],held,held-1u);
  if(taken.exchanged){slot=atomicLoad(&work[W_STACK+held-1u]);}
  held=taken.old_value;
 }
 return slot;
}
/** The probe of the slot queued as the entry \`rank\`: whether its map is traced at half its side whatever its distance. */
fn queueProbe(rank:u32,slot:u32,downsampled:bool){
 let at=rank*QUEUE_WORDS;
 let cell=slotCell(slot);
 probeQueue[at]=packQueued(slot,slotWord(slot,SLOT_LEVEL),downsampled);
 probeQueue[at+1u]=bitcast<u32>(cell.x);
 probeQueue[at+2u]=bitcast<u32>(cell.y);
 probeQueue[at+3u]=bitcast<u32>(cell.z);
}
/** A trace of the probe of the slot at this image: its first publishes it to the table; the updates it took are counted, up to the settled ones. */
fn traced(slot:u32){
 let at=slot*SLOT_WORDS;
 let first=slots[at+SLOT_TRACED]==0u;
 slots[at+SLOT_TRACED]=imageRank();
 slots[at+SLOT_TRACES]=min(slots[at+SLOT_TRACES]+1u,SETTLED_TRACES);
 if(first){
  let entry=slots[at+SLOT_OWNER]-1u;
  table[entry]=(table[entry]&0xffffu)|((slot+1u)<<16u);
 }
}
/** Where the histogram of \`count\` words from \`first\` stops being able to give \`limit\` whole: the first bucket whose cost does not fit, and
 *  how much of it fits. */
fn cutOf(first:u32,count:u32,limit:u32)->vec2u{
 var room=limit;
 for(var bucket=0u;bucket<count;bucket++){
  let cost=atomicLoad(&work[first+bucket]);
  if(cost>room){return vec2u(bucket,room);}
  room-=cost;
 }
 return vec2u(count,0u);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn clearWork(@builtin(global_invocation_id) id:vec3u){
 if(id.x<W_STACK&&id.x!=W_FREE&&id.x!=W_REFUSED&&id.x!=W_HIGH){atomicStore(&work[id.x],0u);}
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn restartProbes(@builtin(global_invocation_id) id:vec3u){
 if(id.x<bounce.counts.w&&slotWord(id.x,SLOT_OWNER)!=0u){slots[id.x*SLOT_WORDS+SLOT_TRACES]=0u;}
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn releaseProbes(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w||slotWord(slot,SLOT_OWNER)==0u){return;}
 var gone=!levelHolds(slotWord(slot,SLOT_LEVEL),slotCell(slot));
 if(!gone&&pool.marking!=0u){
  let entry=slotWord(slot,SLOT_OWNER)-1u;
  if(((atomicLoad(&marks[entry>>5u])>>(entry&31u))&1u)!=0u){
   slots[slot*SLOT_WORDS+SLOT_USED]=imageRank();
  }else{
   gone=imageRank()-slotWord(slot,SLOT_USED)>=KEPT_MARKS;
  }
 }
 if(gone){giveBack(slot);}
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn allocateProbes(@builtin(global_invocation_id) id:vec3u){
 let word=id.x;
 if(word>=(entries()+31u)/32u){return;}
 var bits=atomicLoad(&marks[word]);
 loop{
  if(bits==0u){break;}
  let entry=word*32u+firstTrailingBit(bits);
  bits=bits&(bits-1u);
  if(entry>=entries()){break;}
  atomicAdd(&work[W_MARKED],1u);
  if((table[entry]&0xffffu)!=0u){continue;}
  let slot=takeSlot();
  if(slot==NO_SLOT){
   atomicAdd(&work[W_REFUSED],1u);
   continue;
  }
  atomicMax(&work[W_HIGH],slot+1u);
  let cell=entryCell(entry);
  let at=slot*SLOT_WORDS;
  slots[at+SLOT_OWNER]=entry+1u;
  slots[at+SLOT_CELL]=bitcast<u32>(cell.x);
  slots[at+SLOT_CELL+1u]=bitcast<u32>(cell.y);
  slots[at+SLOT_CELL+2u]=bitcast<u32>(cell.z);
  slots[at+SLOT_USED]=imageRank();
  slots[at+SLOT_TRACED]=0u;
  slots[at+SLOT_TRACES]=0u;
  slots[at+SLOT_LEVEL]=entryLevel(entry);
  table[entry]=(table[entry]&0xffff0000u)|(slot+1u);
 }
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn countProbes(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w){return;}
 if(untraced(slot)){
  let level=slotWord(slot,SLOT_LEVEL);
  let cell=slotCell(slot);
  atomicAdd(&work[W_UNTRACED+untracedBucket(level,cell)],1u);
  atomicAdd(&work[W_WAITING],probeCost(level,cell));
  atomicAdd(&work[W_ELIGIBLE],1u);
 }else if(refreshing(slot)){
  let level=slotWord(slot,SLOT_LEVEL);
  atomicAdd(&work[W_TRACED+tracedBucket(level,slotWord(slot,SLOT_TRACED))],probeCost(level,slotCell(slot)));
 }
}
@compute @workgroup_size(1)
fn cutUntraced(){
 let cut=cutOf(W_UNTRACED,bounce.counts.y*DISTANCE_BUCKETS,QUEUE_ENTRIES);
 atomicStore(&work[W_CUT_UNTRACED],cut.x);
 atomicStore(&work[W_ROOM_UNTRACED],cut.y);
 atomicStore(&work[W_SPENT],min(QUEUE_ENTRIES,atomicLoad(&work[W_ELIGIBLE]))*COST_DOWNSAMPLED);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn emitUntraced(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w||!untraced(slot)){return;}
 let level=slotWord(slot,SLOT_LEVEL);
 let cell=slotCell(slot);
 let bucket=untracedBucket(level,cell);
 let cut=atomicLoad(&work[W_CUT_UNTRACED]);
 if(bucket>cut||(bucket==cut&&!takeRoom(W_ROOM_UNTRACED,1u))){return;}
 let rank=atomicAdd(&work[W_QUEUED],1u);
 if(rank>=QUEUE_ENTRIES){return;}
 let extra=probeCost(level,cell)-COST_DOWNSAMPLED;
 let spent=atomicAdd(&work[W_SPENT],extra);
 queueProbe(rank,slot,spent+extra>pool.room);
 traced(slot);
}
@compute @workgroup_size(1)
fn cutTraced(){
 let first=atomicLoad(&work[W_QUEUED]);
 let left=i32(pool.room)-i32(atomicLoad(&work[W_WAITING]));
 atomicStore(&work[W_CUT_TRACED],NONE_BUCKET);
 if(left>0&&QUEUE_ENTRIES>first){
  let cut=cutOf(W_TRACED,PRIORITY_BUCKETS,u32(left));
  atomicStore(&work[W_CUT_TRACED],cut.x);
  atomicStore(&work[W_ROOM_TRACED],cut.y);
 }
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn emitTraced(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w||!refreshing(slot)){return;}
 let cut=atomicLoad(&work[W_CUT_TRACED]);
 let level=slotWord(slot,SLOT_LEVEL);
 let bucket=tracedBucket(level,slotWord(slot,SLOT_TRACED));
 if(cut==NONE_BUCKET||bucket>cut){return;}
 if(bucket==cut&&!takeRoom(W_ROOM_TRACED,probeCost(level,slotCell(slot)))){return;}
 let rank=atomicAdd(&work[W_QUEUED],1u);
 if(rank>=QUEUE_ENTRIES){return;}
 queueProbe(rank,slot,false);
 traced(slot);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn tallyProbes(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w||slotWord(slot,SLOT_OWNER)==0u){return;}
 atomicAdd(&work[W_LIVE],1u);
 if(slotWord(slot,SLOT_TRACED)==0u){atomicAdd(&work[W_UNFILLED],1u);}
 if(slotWord(slot,SLOT_TRACES)<SETTLED_TRACES){atomicAdd(&work[W_REFRESHING],1u);}
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn publishTable(@builtin(global_invocation_id) id:vec3u){
 let texel=id.x;
 if(texel>=(entries()+TABLE_LANES-1u)/TABLE_LANES){return;}
 var lanes=vec4f(0.0);
 for(var lane=0u;lane<TABLE_LANES;lane++){
  let entry=texel*TABLE_LANES+lane;
  if(entry<entries()){lanes[lane]=f32(table[entry]>>16u);}
 }
 let place=vec2u(texel%TABLE_WIDTH,texel/TABLE_WIDTH);
 textureStore(publishedOut,place,TABLE_LAYER,lanes);
}`,
  [POOL_STATE, QUEUE_WORD_WGSL, WORKGROUP_THREADS_WGSL],
)

/**
 * THE SLOTS' ARGUMENTS and THE END OF THE POOL'S PASS. `sizeSlots`: the dispatch over the slots ever given, in the buffer the kernels never bind
 * (a buffer read as arguments is not written in the same dispatch). `finishQueue`: the probes queued are counted (held to the queue), the count written into the levels' uniform
 * (`frame.y`: the probes dispatched, which the cache's kernels bound themselves by) and the arguments of the dispatches over
 * the queue written — one group a probe for the radiance cache's tiles, its filter and its levels of detail, the clear of the importance functions over their words.
 */
export const POOL_FINISH_SHADER = wgslProgram(
  `@group(0) @binding(${F.work}) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(${F.args}) var<storage,read_write> args:array<u32>;
@group(0) @binding(${F.grid}) var<storage,read_write> gridWords:array<u32>;
fn groupsOf(threads:u32)->u32{return (threads+WORKGROUP_THREADS-1u)/WORKGROUP_THREADS;}
@compute @workgroup_size(1)
fn sizeSlots(){
 args[${POOL_ARGS.slots}u]=groupsOf(atomicLoad(&work[W_HIGH]));
 args[${POOL_ARGS.slots + 1}u]=1u;
 args[${POOL_ARGS.slots + 2}u]=1u;
}
@compute @workgroup_size(1)
fn finishQueue(){
 let count=min(atomicLoad(&work[W_QUEUED]),QUEUE_ENTRIES);
 gridWords[${BOUNCE_GRID.at.frame + 1}u]=count;
 args[${POOL_ARGS.probes}u]=count;
 args[${POOL_ARGS.probes + 1}u]=1u;
 args[${POOL_ARGS.probes + 2}u]=1u;
 args[${POOL_ARGS.clear}u]=groupsOf(count*${CACHE_PDF_WORDS}u);
 args[${POOL_ARGS.clear + 1}u]=1u;
 args[${POOL_ARGS.clear + 2}u]=1u;
}`,
  [POOL_CONSTS],
)
