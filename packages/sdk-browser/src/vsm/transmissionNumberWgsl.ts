import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import type { VsmLayout } from './layout.ts'
import { ARGS_WGSL, VSM_TRANSMISSION_PAGE_GROUP, frameWgsl } from './transmissionShared.ts'

/**
 * `vsmTransmissionNumber`, one group: over the dirty list, each stamped slice with a record takes
 * this frame's number k (in list order, by a prefix sum in the group) and its first place in the
 * order (the records before it); then the dispatches of the place (a thread a record), the resolve
 * (a group a numbered slice) and the headers (a thread a dirty slice). Group 0: 0 frame uniform,
 * 1 build buffer, 2 the dispatch arguments.
 */
export const vsmTransmissionNumberWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(0) @binding(0) var<uniform> frame:VsmTransmissionFrame;
@group(0) @binding(1) var<storage,read_write> build:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
var<workgroup> sums:array<vec2u,${VSM_TRANSMISSION_PAGE_GROUP}>;
/** Records slice \`key\` holds this frame: none unless the clear stamped it. */
fn vsmTRecordsOf(key:u32)->u32{
 if(atomicLoad(&build[VSM_T_STAMPS+key])!=frame.stamp){return 0u;}
 return atomicLoad(&build[VSM_T_COUNTS+key]);
}
@compute @workgroup_size(${VSM_TRANSMISSION_PAGE_GROUP}) fn vsmTransmissionNumber(@builtin(local_invocation_index) lane:u32){
 let dirty=min(atomicLoad(&build[VSM_TC_DIRTY]),VSM_T_KEY_COUNT);
 let per=(dirty+${VSM_TRANSMISSION_PAGE_GROUP - 1}u)/${VSM_TRANSMISSION_PAGE_GROUP}u;
 let lo=min(lane*per,dirty);let hi=min(lo+per,dirty);
 var own=vec2u(0u);
 for(var i=lo;i<hi;i++){
  let r=vsmTRecordsOf(atomicLoad(&build[VSM_T_DIRTY+i]));
  if(r>0u){own+=vec2u(1u,r);}
 }
 sums[lane]=own;
 workgroupBarrier();
 for(var d=1u;d<${VSM_TRANSMISSION_PAGE_GROUP}u;d<<=1u){
  var add=vec2u(0u);
  if(lane>=d){add=sums[lane-d];}
  workgroupBarrier();
  sums[lane]+=add;
  workgroupBarrier();
 }
 var at=sums[lane]-own;
 for(var i=lo;i<hi;i++){
  let key=atomicLoad(&build[VSM_T_DIRTY+i]);
  let r=vsmTRecordsOf(key);
  if(r==0u){continue;}
  atomicStore(&build[VSM_T_KEYS+at.x],key);
  atomicStore(&build[VSM_T_FIRST+key],at.y);
  at+=vec2u(1u,r);
 }
 if(lane==${VSM_TRANSMISSION_PAGE_GROUP - 1}u){
  let total=sums[lane];
  atomicStore(&build[VSM_TC_SLICES],total.x);
  vsmTArgs(0u,(total.y+${VSM_TRANSMISSION_PAGE_GROUP - 1}u)/${VSM_TRANSMISSION_PAGE_GROUP}u);
  vsmTArgs(3u,total.x);
  vsmTArgs(6u,(dirty+${VSM_TRANSMISSION_PAGE_GROUP - 1}u)/${VSM_TRANSMISSION_PAGE_GROUP}u);
 }
}
`,
    [frameWgsl(layout), ARGS_WGSL],
  )

/** `vsmTransmissionPlace`, a thread a record: its index in the order, at its slice's first place
 *  plus its own. Group 0: 0 frame uniform, 1 build buffer. */
export const vsmTransmissionPlaceWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(0) @binding(0) var<uniform> frame:VsmTransmissionFrame;
@group(0) @binding(1) var<storage,read_write> build:array<u32>;
@compute @workgroup_size(${VSM_TRANSMISSION_PAGE_GROUP}) fn vsmTransmissionPlace(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let g=flatIndex(wid,nwg,1u)*${VSM_TRANSMISSION_PAGE_GROUP}u+lane;
 if(g>=min(build[VSM_TC_RECORDS],frame.records)){return;}
 let r=frame.regionRecords+g*VSM_T_RECORD_WORDS;
 build[VSM_T_ORDER+build[VSM_T_FIRST+build[r+16u]]+build[r+17u]]=g;
}
`,
    [frameWgsl(layout)],
  )
