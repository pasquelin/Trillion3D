/**
 * Inclusive scan of one `u32` per lane over a 64-lane workgroup, in workgroup memory: each step
 * adds the total `step` lanes below. `laneScan` returns the lane's inclusive prefix; `laneSums[63]`
 * then holds the workgroup's total until the next call. Every lane calls it from uniform control
 * flow, and a caller that calls it in a loop puts a barrier between reading `laneSums` and the
 * next call. u32 addition wraps and is associative: the result is the serial sum's, term for term.
 * Shared by the draw prefix (`../draw/shader.ts`) and the tested-half compaction
 * (`../raster/restCompactWgsl.ts`).
 */
export const LANE_SCAN_WGSL = `
var<workgroup> laneSums:array<u32,64>;
fn laneScan(lane:u32,value:u32)->u32{
 laneSums[lane]=value;
 for(var step=1u;step<64u;step=step<<1u){
  workgroupBarrier();
  var below=0u;
  if(lane>=step){below=laneSums[lane-step];}
  workgroupBarrier();
  laneSums[lane]=laneSums[lane]+below;
 }
 workgroupBarrier();
 return laneSums[lane];
}
`;
