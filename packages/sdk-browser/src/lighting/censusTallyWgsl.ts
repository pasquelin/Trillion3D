/** Bytes of workgroup memory a tally of `words` counters holds. */
export const censusTallyBytes = (words: number) => words * 4

/**
 * THE WAY THE ENGINE'S CENSUSES COUNT (the probes', `bounce/probes/censusWgsl.ts`, and the reflections',
 * `reflections/censusWgsl.ts`): a workgroup counts in memory of its own and adds to the buffer once. A thread
 * adds its count to a word of the workgroup's tally (`censusAdd`); after a workgroup barrier,
 * `censusFlush` gives each word to one lane, which adds it to the same word of `buffer`, a counter array of
 * `words` atomics. So a ray costs an add in workgroup memory, and a workgroup at most `words` global atomics.
 * The text is declared where the buffer is: `lanes`, the workgroup's width, holds a lane a word.
 */
export function censusTally(buffer: string, words: number, lanes: number) {
  if (words > lanes)
    throw new RangeError(`the census holds ${words} words, more than ${lanes} lanes`)
  return `var<workgroup> censusLocal:array<atomic<u32>,${words}>;
fn censusAdd(word:u32,count:u32){atomicAdd(&censusLocal[word],count);}
fn censusFlush(lane:u32){
 if(lane<${words}u){
  let n=atomicLoad(&censusLocal[lane]);
  if(n!=0u){atomicAdd(&${buffer}[lane],n);}
 }
}`
}
