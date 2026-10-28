import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { BOUNCE_ATLAS_FORMAT, TABLE_LANES, TABLE_LAYER, TABLE_WIDTH } from '../atlas.ts'
import { BOUNCE_CELLS_WGSL, BOUNCE_GRID_STRUCTS_WGSL } from '../gridWgsl.ts'
import { PROBE_QUEUE_WORDS, QUEUE_WORD_WGSL } from '../probes/probeQueueWgsl.ts'
import { BOUNCE_GRID } from '../uniform.ts'
import {
  FINISH_BINDINGS as F,
  POOL_ARGS,
  POOL_BINDINGS as B,
  POOL_ADAPTIVE,
  POOL_COST,
  POOL_PARAMS,
  POOL_PRIORITY_BUCKETS,
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
    SLOT_LEVEL: POOL_SLOT.level,
    SLOT_OFFSET: POOL_SLOT.offset,
    SLOT_RANK: POOL_SLOT.rank,
    MAX_ADAPTIVE: POOL_ADAPTIVE.probes,
    ADAPTIVE_MISSES: POOL_ADAPTIVE.misses,
    ADAPTIVE_PRECISION: POOL_ADAPTIVE.precision,
    W_FREE: POOL_WORK.free,
    W_REFUSED: POOL_WORK.refused,
    W_QUEUED: POOL_WORK.queued,
    W_SPENT: POOL_WORK.spent,
    W_TAKEN: POOL_WORK.taken,
    W_CUT: POOL_WORK.cut,
    W_ROOM: POOL_WORK.room,
    W_MARKED: POOL_WORK.marked,
    W_LIVE: POOL_WORK.live,
    W_UNFILLED: POOL_WORK.unfilled,
    W_REFRESHING: POOL_WORK.refreshing,
    W_HIGH: POOL_WORK.high,
    W_CHANGED: POOL_WORK.changed,
    W_PRIORITY: POOL_WORK.priority,
    W_STACK: POOL_WORK.stack,
    PRIORITY_BUCKETS: POOL_PRIORITY_BUCKETS,
    COST_DOWNSAMPLED: POOL_COST.downsampled,
    COST_NORMAL: POOL_COST.normal,
    COST_SUPERSAMPLED: POOL_COST.supersampled,
    QUEUE_WORDS: PROBE_QUEUE_WORDS,
    NO_SLOT: 0xffffffff,
    TABLE_WIDTH,
    TABLE_LAYER,
    TABLE_LANES,
  }),
)

/**
 * THE POOL'S STATE, as the kernels read it: the levels' uniform (`bounce`) and the pool's parameters (`pool`), the slots (`slots`, a record of
 * `SLOT_WORDS` words each, `POOL_SLOT`), the table (`table`: an entry a word — the slot plus one that holds the cell in the low sixteen
 * bits, its indirection, cleared and made again every pass, the slot plus one the lit passes read for it in the high sixteen, which a
 * probe takes at its first trace and gives back with its cell), the adaptive probes of each entry (`adaptive`, `POOL_BINDINGS.adaptive`: the same two halves, a word a rank) and the interpolation misses
 * the pixels counted (`misses`), both read and written only where the pool is adaptive (`pool.adaptive`), the work buffer (`work`, `POOL_WORK`) and the marks' bitmap (`marks`).
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
@group(0) @binding(${B.adaptive}) var<storage,read_write> adaptive:array<u32>;
@group(0) @binding(${B.misses}) var<storage,read_write> misses:array<u32>;
fn entries()->u32{return bounce.counts.y*bounce.counts.z;}
/** The word of the adaptive probe of rank \`rank\` (one or two) of the entry \`entry\`. */
fn adaptiveAt(entry:u32,rank:u32)->u32{return entry*MAX_ADAPTIVE+rank-1u;}
/** The frame number: the images the pool has worked in, from one. */
fn frameNumber()->u32{return bounce.frame.z;}
fn slotWord(slot:u32,word:u32)->u32{return slots[slot*SLOT_WORDS+word];}
fn slotCell(slot:u32)->vec3i{
 let at=slot*SLOT_WORDS+SLOT_CELL;
 return bitcast<vec3i>(vec3u(slots[at],slots[at+1u],slots[at+2u]));
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
 let squared=cameraDistanceSq(bounce.eye.xyz-probePosition(cell,bounce.levels[level].spacing));
 return select(select(COST_NORMAL,COST_SUPERSAMPLED,squared<pool.distances.y),COST_DOWNSAMPLED,squared>=pool.distances.x);
}
/** The bucket of a probe: a probe never traced is in the first, which is always traced; else the frames from its trace to its last use (one
 *  where it was not used since) over its level plus one, their log₂ held between none and the last but one, counted back from the last
 *  bucket and cut to a whole number: the sooner the probe is wanted, the lower its bucket. */
fn priorityBucket(level:u32,tracedAt:u32,usedAt:u32)->u32{
 if(tracedAt==0u){return 0u;}
 let between=select(1u,usedAt-tracedAt,usedAt>tracedAt);
 let importance=f32(between)/(f32(level)+1.0);
 return u32(f32(PRIORITY_BUCKETS-1u)-clamp(log2(importance),0.0,f32(PRIORITY_BUCKETS-2u)));
}
/** Whether the slot holds a probe: every probe the pool holds is in the histogram the budget chooses among. */
fn holds(slot:u32)->bool{return slotWord(slot,SLOT_OWNER)!=0u;}
/** Whether the marks name the entry: a cell some pixel of the image reads. */
fn marked(entry:u32)->bool{return ((atomicLoad(&marks[entry>>5u])>>(entry&31u))&1u)!=0u;}`,
)

/**
 * The pool's kernels over the slots, the table and the work buffer, one program, dispatched in this order by `pool.ts`:
 *
 * - `clearIndirection`, a thread an entry: the slot every entry named is forgotten; the published half is left. The marks of the image's cells
 *   are made after it (`pool.ts`), the bitmap they set read from `updateProbes` on.
 * - `updateProbes`, a thread a slot: the probe of the last pass's indirection is put back in it if its cell is still held by its level and the
 *   marks read it now (stamped with the frame number) or it was read in the last `keep` frames (two at most where the free slots hold fewer than the
 *   frame's budget of new probes); else it is given back (its published half cleared, its
 *   slot on the stack); in a full update (`fullUpdate`) every probe is given back, so that the cells the image reads take new ones, all never traced.
 *   It touches only the stack of free slots and the slots, nothing `clearWork` zeroes.
 * - `clearWork`: the counters, the histogram and the cut of the image, zeroed.
 * - `stampChange`, where the lights changed: the frame number kept as the frame of the change (`changed`).
 * - `allocateProbes`, a thread a word of the marks' bitmap: each cell marked that holds no probe takes one from the stack, or, with none
 *   left, is refused (`refused` counts them in all): the cell goes unanswered, and the next level or the sky light answers for it.
 * - `countProbes`, a thread a slot: every probe is counted, at its cost, in the bucket of its priority (`priorityBucket`); those in the
 *   first, never traced, also in the cheapest cost every one of them could take (`spent`).
 * - `cutProbes`: the bucket the budget stops in, and what is left of it for that bucket.
 * - `emitProbes`, a thread a slot: the probes in the buckets before the cut are queued; those in the cut's, as far as the room it has left is
 *   not passed by their costs, taken in turn; those in the first bucket always, each at a quarter of its map's side once the cost already
 *   spent has passed the budget —: the first trace of a cell is what lets it answer at all. No more than the frame's `cap` are queued, and the
 *   count is held to it. A probe queued is counted as a trace, and its
 *   first publishes it to the table (the lit passes read a probe once its map is made).
 * - `finishQueue` (`POOL_FINISH_SHADER`), right after the probes are chosen: the arguments of the dispatches over the queue.
 * - `tallyProbes`, a thread a slot: the probes alive, those that hold nothing yet and those not traced since the lights last changed (the first among them), counted
 *   for the CPU.
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
/** Gives the probe of the slot back: the slot the lit passes read for its entry forgotten (an adaptive probe's word whole), its slot on the stack. */
fn giveBack(slot:u32){
 let at=slot*SLOT_WORDS;
 let entry=slots[at+SLOT_OWNER]-1u;
 let rank=slots[at+SLOT_RANK];
 if(rank==0u){
  if((table[entry]>>16u)==slot+1u){table[entry]=table[entry]&0xffffu;}
 }else{
  adaptive[adaptiveAt(entry,rank)]=0u;
 }
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
 probeQueue[at]=packQueued(slot,slotWord(slot,SLOT_LEVEL),downsampled,slotWord(slot,SLOT_RANK));
 probeQueue[at+1u]=u32(cell.x);
 probeQueue[at+2u]=u32(cell.y);
 probeQueue[at+3u]=u32(cell.z);
 probeQueue[at+4u]=slotWord(slot,SLOT_OFFSET);
 probeQueue[at+5u]=slotWord(slot,SLOT_OFFSET+1u);
 probeQueue[at+6u]=slotWord(slot,SLOT_OFFSET+2u);
}
/** A trace of the probe of the slot at this image: its first publishes it to the table. */
fn traced(slot:u32){
 let at=slot*SLOT_WORDS;
 let first=slots[at+SLOT_TRACED]==0u;
 slots[at+SLOT_TRACED]=frameNumber();
 if(first){
  let entry=slots[at+SLOT_OWNER]-1u;
  let rank=slots[at+SLOT_RANK];
  if(rank==0u){
   table[entry]=(table[entry]&0xffffu)|((slot+1u)<<16u);
  }else{
   let word=adaptiveAt(entry,rank);
   adaptive[word]=(adaptive[word]&0xffffu)|((slot+1u)<<16u);
  }
 }
}
/** Where the histogram of \`count\` words from \`first\` stops being able to give \`limit\` whole: the first bucket whose cost brings the sum to the
 *  limit or past it, and what is left of the limit for it; where none does, one past the last bucket, with the whole limit left. */
fn cutOf(first:u32,count:u32,limit:u32)->vec2u{
 var sum=0u;
 for(var bucket=0u;bucket<count;bucket++){
  let cost=atomicLoad(&work[first+bucket]);
  if(sum+cost>=limit){return vec2u(bucket,limit-sum);}
  sum+=cost;
 }
 return vec2u(count,limit);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn clearWork(@builtin(global_invocation_id) id:vec3u){
 if(id.x<W_STACK&&id.x!=W_FREE&&id.x!=W_REFUSED&&id.x!=W_HIGH&&id.x!=W_CHANGED){atomicStore(&work[id.x],0u);}
}
@compute @workgroup_size(1)
fn stampChange(){atomicStore(&work[W_CHANGED],frameNumber());}
@compute @workgroup_size(WORKGROUP_THREADS)
fn clearIndirection(@builtin(global_invocation_id) id:vec3u){
 if(id.x<entries()){
  table[id.x]=table[id.x]&0xffff0000u;
  if(pool.adaptive!=0u){
   for(var rank=1u;rank<=MAX_ADAPTIVE;rank++){
    let word=adaptiveAt(id.x,rank);
    adaptive[word]=adaptive[word]&0xffff0000u;
   }
  }
 }
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn updateProbes(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w||!holds(slot)){return;}
 // An adaptive probe follows its cell's own (\`updateAdaptive\`).
 if(slotWord(slot,SLOT_RANK)!=0u){return;}
 let entry=slotWord(slot,SLOT_OWNER)-1u;
 var kept=levelHolds(slotWord(slot,SLOT_LEVEL),slotCell(slot));
 if(kept&&marked(entry)){
  slots[slot*SLOT_WORDS+SLOT_USED]=frameNumber();
 }else if(kept){
  // Short of room for the frame's budget of new probes (the free slots, as they stand), a probe nothing reads is kept two frames at most.
  let keep=select(pool.keep,min(2u,pool.keep),atomicLoad(&work[W_FREE])*COST_NORMAL<pool.room);
  kept=frameNumber()-slotWord(slot,SLOT_USED)<keep;
 }
 if(kept&&pool.fullUpdate==0u){table[entry]=table[entry]|(slot+1u);}else{giveBack(slot);}
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
  slots[at+SLOT_CELL]=u32(cell.x);
  slots[at+SLOT_CELL+1u]=u32(cell.y);
  slots[at+SLOT_CELL+2u]=u32(cell.z);
  slots[at+SLOT_USED]=frameNumber();
  slots[at+SLOT_TRACED]=0u;
  slots[at+SLOT_LEVEL]=entryLevel(entry);
  slots[at+SLOT_RANK]=0u;
  slots[at+SLOT_OFFSET]=0u;
  slots[at+SLOT_OFFSET+1u]=0u;
  slots[at+SLOT_OFFSET+2u]=0u;
  table[entry]=(table[entry]&0xffff0000u)|(slot+1u);
 }
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn updateAdaptive(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w||!holds(slot)){return;}
 let rank=slotWord(slot,SLOT_RANK);
 if(rank==0u){return;}
 let entry=slotWord(slot,SLOT_OWNER)-1u;
 // Kept while its cell's own probe is (this pass's indirection holds it), the cell is held by its level and a pixel read it in the frames the pool keeps probes.
 var kept=(table[entry]&0xffffu)!=0u&&pool.fullUpdate==0u&&levelHolds(slotWord(slot,SLOT_LEVEL),slotCell(slot));
 if(kept){kept=frameNumber()-slotWord(slot,SLOT_USED)<pool.keep;}
 if(kept){
  let word=adaptiveAt(entry,rank);
  adaptive[word]=(adaptive[word]&0xffff0000u)|(slot+1u);
 }else{
  giveBack(slot);
 }
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn allocateAdaptive(@builtin(global_invocation_id) id:vec3u){
 let entry=id.x;
 if(pool.adaptive==0u||entry>=entries()){return;}
 let count=misses[entry];
 let sum=vec3u(misses[entries()+entry],misses[2u*entries()+entry],misses[3u*entries()+entry]);
 misses[entry]=0u;
 misses[entries()+entry]=0u;
 misses[2u*entries()+entry]=0u;
 misses[3u*entries()+entry]=0u;
 if(count<=ADAPTIVE_MISSES||(table[entry]&0xffffu)==0u){return;}
 var rank=0u;
 for(var r=1u;r<=MAX_ADAPTIVE;r++){
  if(rank==0u&&(adaptive[adaptiveAt(entry,r)]&0xffffu)==0u){rank=r;}
 }
 if(rank==0u){return;}
 let slot=takeSlot();
 if(slot==NO_SLOT){return;}
 atomicMax(&work[W_HIGH],slot+1u);
 let level=entryLevel(entry);
 let cell=entryCell(entry);
 // The mean ideal offset the pixels summed in the units of the precision: a whole cell is \`ADAPTIVE_PRECISION\` of them, centred on half.
 let offset=(vec3f(sum)/f32(count)-vec3f(f32(ADAPTIVE_PRECISION)*0.5))*(bounce.levels[level].spacing*2.0/f32(ADAPTIVE_PRECISION));
 let at=slot*SLOT_WORDS;
 slots[at+SLOT_OWNER]=entry+1u;
 slots[at+SLOT_CELL]=u32(cell.x);
 slots[at+SLOT_CELL+1u]=u32(cell.y);
 slots[at+SLOT_CELL+2u]=u32(cell.z);
 slots[at+SLOT_USED]=frameNumber();
 slots[at+SLOT_TRACED]=0u;
 slots[at+SLOT_LEVEL]=level;
 slots[at+SLOT_RANK]=rank;
 slots[at+SLOT_OFFSET]=bitcast<u32>(offset.x);
 slots[at+SLOT_OFFSET+1u]=bitcast<u32>(offset.y);
 slots[at+SLOT_OFFSET+2u]=bitcast<u32>(offset.z);
 let word=adaptiveAt(entry,rank);
 adaptive[word]=(adaptive[word]&0xffff0000u)|(slot+1u);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn countProbes(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w||!holds(slot)){return;}
 let level=slotWord(slot,SLOT_LEVEL);
 let bucket=priorityBucket(level,slotWord(slot,SLOT_TRACED),slotWord(slot,SLOT_USED));
 atomicAdd(&work[W_PRIORITY+bucket],probeCost(level,slotCell(slot)));
 if(bucket==0u){atomicAdd(&work[W_SPENT],COST_DOWNSAMPLED);}
}
@compute @workgroup_size(1)
fn cutProbes(){
 let cut=cutOf(W_PRIORITY,PRIORITY_BUCKETS,pool.room);
 atomicStore(&work[W_CUT],cut.x);
 atomicStore(&work[W_ROOM],cut.y);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn emitProbes(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w||!holds(slot)){return;}
 let level=slotWord(slot,SLOT_LEVEL);
 let bucket=priorityBucket(level,slotWord(slot,SLOT_TRACED),slotWord(slot,SLOT_USED));
 let cut=atomicLoad(&work[W_CUT]);
 if(bucket>cut){return;}
 let cost=probeCost(level,slotCell(slot));
 var downsampled=false;
 if(bucket==cut&&bucket>0u){
  if(atomicAdd(&work[W_TAKEN],cost)+cost>atomicLoad(&work[W_ROOM])){return;}
 }else if(bucket==0u){
  let extra=cost-COST_DOWNSAMPLED;
  downsampled=atomicAdd(&work[W_SPENT],extra)+extra>pool.room;
 }
 let rank=atomicAdd(&work[W_QUEUED],1u);
 if(rank>=pool.cap){
  atomicStore(&work[W_QUEUED],pool.cap);
  return;
 }
 queueProbe(rank,slot,downsampled);
 traced(slot);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn tallyProbes(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot>=bounce.counts.w||!holds(slot)){return;}
 atomicAdd(&work[W_LIVE],1u);
 let tracedAt=slotWord(slot,SLOT_TRACED);
 if(tracedAt==0u){atomicAdd(&work[W_UNFILLED],1u);}
 if(tracedAt==0u||tracedAt<atomicLoad(&work[W_CHANGED])){atomicAdd(&work[W_REFRESHING],1u);}
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
 * THE SLOTS' ARGUMENTS and THE QUEUE'S. `sizeSlots`: the dispatch over the slots ever given, in the buffer the kernels never bind
 * (a buffer read as arguments is not written in the same dispatch). `finishQueue`: the probes queued are counted (held to the queue), the count written into the levels' uniform
 * (`frame.y`: the probes dispatched, which the cache's kernels bound themselves by) and the arguments of the dispatches over
 * the queue written — one group a probe for the radiance cache's tiles, its filter and its levels of detail.
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
 let count=atomicLoad(&work[W_QUEUED]);
 gridWords[${BOUNCE_GRID.at.frame + 1}u]=count;
 args[${POOL_ARGS.probes}u]=count;
 args[${POOL_ARGS.probes + 1}u]=1u;
 args[${POOL_ARGS.probes + 2}u]=1u;
}`,
  [POOL_CONSTS],
)
