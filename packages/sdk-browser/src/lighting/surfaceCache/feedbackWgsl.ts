import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import {
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  WORKGROUP_THREADS_WGSL,
} from '../../gpu/dispatch/grid.ts'
import { FEEDBACK_AT } from './feedbackLayout.ts'

/**
 * THE COMPACTION OF THE FEEDBACK: the elements the rays wrote in an image (`sampleWgsl.ts`,
 * `scWriteFeedback`) hold the same page many times; three kernels list each distinct element once, with
 * the number of times it was written.
 *
 * `buildFeedbackTableArgs`, one thread: the workgroups of the table's building, one thread for each
 * element written (the counter, held to the buffer's size), in rows (`groupGrid`), written as the
 * dispatch's arguments, which the GPU reads for the building.
 * `buildFeedbackTable`, a thread an element written: its two words hashed to a key (`feedbackKey`, the
 * first word mixed, the second added to it), which a table of keys — twice the elements the list may hold,
 * a power of two, linear probing, at most `FEEDBACK_PROBES` places — takes by a compare and swap into the
 * first free place; the place of an element that found its key held is that key's. The thread that took
 * the place records the element's rank there (`firsts`), every thread adds one to the place's count
 * (`counts`); an element that finds no place in its probes is not counted, where it would add its count to
 * the place of another's key. A key of zero is the empty place, so a key the hash makes zero is one: an
 * element of that key would find its place held by the empty place itself, and never be recorded.
 * `compactFeedbackTable`, a thread a place of the table: a place with a count takes the next place of the
 * list (`listed`, whose first element holds the number of the elements taken, which may pass its room,
 * and whose elements follow, two words each) and writes there the words of the element it recorded, the
 * count in the high sixteen bits of the second. The count saturates at 65535: the reference shifts it into the high bits, where a count of 65536 wraps to
 * none and an element written that often is lost (a bug of the reference, not ported).
 *
 * Bindings of group 0: the feedback buffer the rays wrote (`feedback`, read), the table's keys, the
 * rank of each place's first element, its counts, and the list the CPU reads back; the arguments the first
 * kernel writes (`args`) are bound with the feedback buffer alone, the building's group never holding the
 * buffer its dispatch reads as arguments.
 */

const CONSTANTS = wgslConsts({
  FEEDBACK_COUNTER: FEEDBACK_AT.counter,
  FEEDBACK_ELEMENTS: FEEDBACK_AT.elements,
  FEEDBACK_SIZE: FEEDBACK_AT.size,
  FEEDBACK_PROBES: 32,
  FEEDBACK_NO_PLACE: 0xffffffff,
})

/** The binding of the dispatch arguments the first kernel writes. */
export const FEEDBACK_ARGS_BINDING = 5

/** The feedback's compaction program: its three kernels and the bindings they share. */
export const FEEDBACK_COMPACTION_SHADER = wgslProgram(
  `${CONSTANTS}
@group(0) @binding(0) var<storage,read> feedback:array<u32>;
@group(0) @binding(1) var<storage,read_write> keys:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> firsts:array<u32>;
@group(0) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> listed:array<atomic<u32>>;
@group(0) @binding(${FEEDBACK_ARGS_BINDING}) var<storage,read_write> args:array<u32>;
/** The finishing mix of a 32-bit word: every bit of it reaches every bit of the result. */
fn feedbackMix(word:u32)->u32{
 var x=word;
 x^=x>>16u;
 x*=0x85ebca6bu;
 x^=x>>13u;
 x*=0xc2b2ae35u;
 x^=x>>16u;
 return x;
}
/** \`element\` taken into the hash \`hash\`: it is scrambled, folded into the hash, and the hash turned and shifted. */
fn feedbackAdd(hash:u32,element:u32)->u32{
 var scrambled=element*0xcc9e2d51u;
 scrambled=(scrambled<<15u)|(scrambled>>17u);
 scrambled*=0x1b873593u;
 let folded=hash^scrambled;
 return ((folded<<13u)|(folded>>19u))*5u+0xe6546b64u;
}
fn feedbackKey(first:u32,second:u32)->u32{
 return max(feedbackAdd(feedbackMix(first),second),1u);
}
/** The place of \`key\` in the table of keys, taking one for it where it holds none: \`taken\` is whether this call
 *  made it the place's. \`FEEDBACK_NO_PLACE\` where the probes found neither. */
fn feedbackPlace(key:u32,taken:ptr<function,bool>)->u32{
 let mask=arrayLength(&keys)-1u;
 for(var step=0u;step<FEEDBACK_PROBES;step++){
  let at=(key+step)&mask;
  let held=atomicLoad(&keys[at]);
  if(held==key){return at;}
  if(held!=0u){continue;}
  // The exchange may fail with the place still empty: it is tried again there before the next place is probed.
  var swap=atomicCompareExchangeWeak(&keys[at],0u,key);
  while(!swap.exchanged&&swap.old_value==0u){swap=atomicCompareExchangeWeak(&keys[at],0u,key);}
  if(swap.exchanged){*taken=true;return at;}
  if(swap.old_value==key){return at;}
 }
 return FEEDBACK_NO_PLACE;
}
@compute @workgroup_size(1)
fn buildFeedbackTableArgs(){
 let grid=groupGrid(ceilDiv(min(feedback[FEEDBACK_COUNTER],feedback[FEEDBACK_SIZE]),WORKGROUP_THREADS));
 args[0]=grid.x;
 args[1]=grid.y;
 args[2]=1u;
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn buildFeedbackTable(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let rank=flatIndex(id,groups,WORKGROUP_THREADS);
 if(rank>=min(feedback[FEEDBACK_COUNTER],feedback[FEEDBACK_SIZE])){return;}
 let at=feedback[FEEDBACK_ELEMENTS]+2u*rank;
 var taken=false;
 let place=feedbackPlace(feedbackKey(feedback[at],feedback[at+1u]),&taken);
 if(place==FEEDBACK_NO_PLACE){return;}
 if(taken){firsts[place]=rank;}
 atomicAdd(&counts[place],1u);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn compactFeedbackTable(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let place=flatIndex(id,groups,WORKGROUP_THREADS);
 if(place>=arrayLength(&counts)){return;}
 let hits=atomicLoad(&counts[place]);
 if(hits==0u){return;}
 let next=atomicAdd(&listed[0],1u)+1u;
 let rank=firsts[place];
 if(2u*next+1u>=arrayLength(&listed)||rank>=feedback[FEEDBACK_SIZE]){return;}
 let at=feedback[FEEDBACK_ELEMENTS]+2u*rank;
 atomicStore(&listed[2u*next],feedback[at]);
 atomicStore(&listed[2u*next+1u],feedback[at+1u]|(min(hits,0xffffu)<<16u));
}`,
  [FLAT_INDEX_WGSL, GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL],
)

/** The entry that writes the building's dispatch arguments. */
export const FEEDBACK_ARGS_ENTRY = 'buildFeedbackTableArgs'

/** The entries of the compaction program that run over the table, in the order they run, after the arguments' entry. */
export const FEEDBACK_COMPACTION_ENTRIES = ['buildFeedbackTable', 'compactFeedbackTable'] as const
