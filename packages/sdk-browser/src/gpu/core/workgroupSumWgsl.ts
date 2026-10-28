/**
 * THE SUM OF A WORKGROUP'S VALUES, by halves — the f32 sibling of the counters' tally (`workgroupTallyWgsl.ts`):
 * the statements of a loop that adds, for a stride from half the group's `width` down to one, the value of lane
 * `lane + stride` into the value of lane `lane`, a barrier before each step and one after the last, so that lane
 * 0 holds the total for every thread past them. `add` is the statement of one step over `lane` and `stride`
 * (`sums[lane]+=sums[lane+stride];`), whatever the values it adds: a number, a row of them. The statements
 * hold the group's barriers: every thread of the group runs them, from uniform control flow, `lane` its index in the group.
 * `lane` is the text of the thread's index in the group (`lane` by default: `lane.z`, `li`, `at`).
 * `width` is the group's thread count, a power of two the host knows (a number) or the shader names (a constant: the
 * text of an expression of `u32`).
 * @throws RangeError when a numeric `width` is not a power of two, which halving does not cover.
 */
export function workgroupSumLoop(width: number | string, add: string, lane = 'lane') {
  if (
    typeof width === 'number' &&
    (!Number.isInteger(width) || width < 2 || (width & (width - 1)) !== 0)
  )
    throw new RangeError(`a workgroup sums by halves over a power of two, got ${width}`)
  const half = typeof width === 'number' ? `${width / 2}u` : `(${width})/2u`
  return `for(var stride=${half};stride>0u;stride>>=1u){
  workgroupBarrier();
  if(${lane}<stride){${add}}
 }
 workgroupBarrier();`
}
