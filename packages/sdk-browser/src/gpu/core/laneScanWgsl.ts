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
 * Shared by the draw prefix (`../draw/shader.ts`), the tested-half compaction
 * (`../raster/restCompactWgsl.ts`) and the blend expansion (`../../webgpu/blend/expandWgsl.ts`).
 */
export const LANE_SCAN_WGSL = `
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
 let run=(len+63u)/64u;
 let first=min(lane*run,len);
 return vec2u(first,min(first+run,len));
}
`;
