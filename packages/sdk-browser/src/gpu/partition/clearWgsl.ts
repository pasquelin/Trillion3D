import { PARTITION_WORKGROUP, STATE_WORDS } from './contract.ts'

/**
 * What the frame's kernels count from zero, zeroed by the first dispatch of the partition's pass,
 * before `projectRows` tallies: the frame counters, the rest bits of the rows this frame covers —
 * the draw compaction reads none past them — and every slot's count. A dispatch of the same pass
 * as the kernels it serves, where clearing the buffers from the encoder cut that pass. Its thread
 * count is `partitionClearThreads`.
 */
export const PARTITION_CLEAR_WGSL = `
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn clearRows(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i<${STATE_WORDS}u){atomicStore(&state[i],0u);}
 if(i<(uni.rows+31u)/32u){atomicStore(&restBits[i],0u);}
 if(i<arrayLength(&slotUsed)){atomicStore(&slotUsed[i],0u);}
}
`

/** Threads `clearRows` needs for `rows` rows and `slotWords` slot counts: one per word of the
 *  longest of the three. */
export const partitionClearThreads = (rows: number, slotWords: number) =>
  Math.max(STATE_WORDS, Math.ceil(rows / 32), slotWords)
