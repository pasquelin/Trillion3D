import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ceilDiv } from '../../../../math/src/wgsl/integer.ts'

/**
 * Inclusive scan of one `u32` per lane over a 64-lane workgroup, in workgroup memory: each step
 * adds the total `step` lanes below, reading one half of `laneSums` and writing the other, so one
 * barrier per step suffices. `laneScan` returns the lane's inclusive prefix; after its six steps the
 * result is back in the first half, and `laneSums[63]` holds the workgroup's total until the next
 * call. Every lane calls it from uniform control flow, and a caller that calls it in a loop puts a
 * barrier between reading `laneSums` and the next call. u32 addition wraps and is associative: the
 * result is the serial sum's, term for term.
 *
 * `laneRun` splits `len` items into 64 contiguous runs, one per lane: `[first, last)`.
 *
 * `laneRunSum`, `laneRunWalk` and `laneRunOffsets` write, as WGSL text (a function cannot take its
 * array), the loops every user of `laneRun` repeats: a lane totals its run, the scan gives the run
 * its offset, the lane walks the run handing each item its cursor.
 *
 * Shared by the draw prefix (`../draw/shader.ts`), the drawable-page prefix
 * (`../dag/shader/compactWgsl.ts`), the tested-half compaction (`../raster/restCompactWgsl.ts`),
 * the blend expansion (`../../webgpu/blend/expandWgsl.ts`), the light grid's room in its pool
 * (`../../lighting/tiles/compactWgsl.ts`).
 */
export const LANE_SCAN_WGSL = wgslBlock(
  'LANE_SCAN_WGSL',
  [ceilDiv],
  `
var<workgroup> laneSums:array<u32,128>;
fn laneScan(lane:u32,value:u32)->u32{
 var src=0u;
 laneSums[lane]=value;
 for(var step=1u;step<64u;step=step<<1u){
  workgroupBarrier();
  var sum=laneSums[src+lane];
  if(lane>=step){sum=sum+laneSums[src+lane-step];}
  src=64u-src;
  laneSums[src+lane]=sum;
 }
 workgroupBarrier();
 return laneSums[src+lane];
}
fn laneRun(lane:u32,len:u32)->vec2u{
 let run=ceilDiv(len,64u);
 let first=min(lane*run,len);
 return vec2u(first,min(first+run,len));
}
`,
)

/** A lane's `sum` of `size`, an expression of the item `g`, over its run `span`. */
export const laneRunSum = (g: string, span: string, size: string) =>
  `var sum=0u;
 for(var ${g}=${span}.x;${g}<${span}.y;${g}++){sum=sum+${size};}`

/** The lane walks its run, `put` (an expression of `g` and `cursor`) writing each item's place and
 *  `cursor` moving on by its `size`, read before `put` writes. */
export const laneRunWalk = (g: string, span: string, cursor: string, size: string, put: string) =>
  `for(var ${g}=${span}.x;${g}<${span}.y;${g}++){
  let taken=${size};
  ${put};
  ${cursor}=${cursor}+taken;
 }`

/** `laneRunSum`, then the lane's cursor, `base` past the runs before it, then `laneRunWalk`: leaves
 *  `sum` and `cursor` declared, `cursor` the end of the lane's run. Every lane runs it, from uniform control flow. */
export const laneRunOffsets = (
  g: string,
  span: string,
  lane: string,
  base: string,
  size: string,
  put: string,
) => `${laneRunSum(g, span, size)}
 var cursor=${base}laneScan(${lane},sum)-sum;
 ${laneRunWalk(g, span, 'cursor', size, put)}`
