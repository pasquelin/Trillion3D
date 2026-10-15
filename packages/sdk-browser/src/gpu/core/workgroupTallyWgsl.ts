import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE workgroup-reduced counters: a workgroup sums its threads' counts in workgroup memory —
 * a workgroup atomic, no memory traffic —, then lane `k` pours counter `k` into its frame word
 * (`pour`, a WGSL body of `lane` and `n`) when it counted anything. One global atomic per group and
 * counter instead of one per thread: u32 sums wrap and are associative, so the frame words hold
 * what one atomic per thread gave, term for term.
 *
 * `counting` is a uniform WGSL condition (`true` when the counters are always kept); `first` the
 * first counter poured (the ones before it are never tallied). The module declares the frame words
 * `pour` writes; its entry point calls `flushTally` from uniform control flow, every thread of the
 * group, and workgroup memory starts at zero for each group (WGSL), so nothing opens the tally.
 */
export const workgroupTallyWgsl = (
  name: string,
  words: number,
  counting: string,
  pour: string,
  first = 0,
) =>
  wgslBlock(
    name,
    [],
    `var<workgroup> tally:array<atomic<u32>,${words}>;
fn tallyAdd(word:u32,n:u32){if(${counting}){atomicAdd(&tally[word],n);}}
fn pourTally(lane:u32,n:u32){${pour}}
fn flushTally(lane:u32){
 if(!(${counting})){return;}
 workgroupBarrier();
 if(lane>=${first}u&&lane<${words}u){let n=atomicLoad(&tally[lane]);if(n!=0u){pourTally(lane,n);}}
}`,
  )
