import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { FEEDBACK_AT } from './feedbackLayout.ts'

/**
 * THE COMPACTION OF THE FEEDBACK: the elements the rays wrote in an image (`sampleWgsl.ts`,
 * `scWriteFeedback`) hold the same page many times; two kernels list each distinct element once, with
 * the number of times it was written.
 *
 * `buildFeedbackTable`, a thread an element written: its two words hashed to a key, which a table of
 * keys — twice the elements the list may hold, a power of two, linear probing, at most
 * `FEEDBACK_PROBES` places — takes by a compare and swap into the first free place; the place of an
 * element that found its key held is that key's. The thread that took the place records the element's
 * rank there (`firsts`), every thread adds one to the place's count (`counts`); an element that finds no
 * place in its probes is not counted. A key of zero is the empty place, so the key of an element is one
 * at least.
 * `compactFeedbackTable`, a thread a place of the table: a place with a count takes the next place of the
 * list (`listed`, whose first element holds the number of the elements taken, which may pass its room,
 * and whose elements follow, two words each) and writes there the words of the element it recorded, the
 * count in the high sixteen bits of the second.
 *
 * Bindings of group 0: the feedback buffer the rays wrote (`feedback`, read), the table's keys, the
 * rank of each place's first element, its counts, and the list the CPU reads back.
 */

const CONSTANTS = wgslConsts({
  FEEDBACK_COUNTER: FEEDBACK_AT.counter,
  FEEDBACK_ELEMENTS: FEEDBACK_AT.elements,
  FEEDBACK_SIZE: FEEDBACK_AT.size,
  FEEDBACK_PROBES: 32,
  FEEDBACK_NO_PLACE: 0xffffffff,
})

/** The feedback's compaction program: both kernels and the bindings they share. */
export const FEEDBACK_COMPACTION_SHADER = wgslProgram(
  `${CONSTANTS}
@group(0) @binding(0) var<storage,read> feedback:array<u32>;
@group(0) @binding(1) var<storage,read_write> keys:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> firsts:array<u32>;
@group(0) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> listed:array<atomic<u32>>;
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
fn feedbackKey(first:u32,second:u32)->u32{
 return max(feedbackMix(feedbackMix(first)+second*0x9e3779b1u),1u);
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
  let swap=atomicCompareExchangeWeak(&keys[at],0u,key);
  if(swap.exchanged){*taken=true;return at;}
  if(swap.old_value==key){return at;}
 }
 return FEEDBACK_NO_PLACE;
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
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
)

/** The entries of the compaction program, in the order they run. */
export const FEEDBACK_COMPACTION_ENTRIES = ['buildFeedbackTable', 'compactFeedbackTable'] as const
