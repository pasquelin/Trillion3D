import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE SORT OF A WORKGROUP'S ENTRIES in its own memory: a bitonic network over `count` entries of the workgroup array
 * `array` (`array<vec2u,count>`, declared by the program), a thread each, ascending by the f32 key an entry holds in
 * `y` (its bits) and, for equal keys, descending by its `x`: a total order, so the sorted sequence is the one
 * any sort gives. `<array>Sort(lane)` runs the whole network and ends on a barrier: every thread of the group
 * calls it, from uniform control flow. The steps fixed by `count` alone cost `log²(count)` barriers and no
 * atomic; a step is `<array>Step(lane, k, j)`, one compare-exchange, without a barrier.
 * @throws RangeError when `count` is not a power of two, which the network does not cover.
 */
export const workgroupSortWgsl = (array: string, count: number) => {
  if (!Number.isInteger(count) || count < 2 || (count & (count - 1)) !== 0)
    throw new RangeError(`a workgroup sorts a power of two of entries, got ${count}`)
  return wgslBlock(
    `workgroupSortWgsl(${array}, ${count})`,
    [],
    `/** Whether entry \`a\` comes before \`b\`: a smaller key, or the same key and a larger \`x\`. */
fn ${array}Before(a:vec2u,b:vec2u)->bool{
 let ka=bitcast<f32>(a.y);
 let kb=bitcast<f32>(b.y);
 return ka<kb||(ka==kb&&a.x>b.x);
}
/** One compare-exchange of the network, \`lane\` against \`lane ^ j\` in the blocks of \`k\`. */
fn ${array}Step(lane:u32,k:u32,j:u32){
 let other=lane^j;
 if(other>lane){
  let a=${array}[lane];
  let b=${array}[other];
  if(select(${array}Before(a,b),${array}Before(b,a),(lane&k)==0u)){${array}[lane]=b;${array}[other]=a;}
 }
}
fn ${array}Sort(lane:u32){
 for(var k=2u;k<=${count}u;k<<=1u){
  for(var j=k>>1u;j>0u;j>>=1u){
   workgroupBarrier();
   ${array}Step(lane,k,j);
  }
 }
 workgroupBarrier();
}`,
  )
}
