import { FEEDBACK_EVERY, FEEDBACK_STRIDE } from './feedback.ts'

/** Phase pixels on one side of a workgroup of the reduction (`reduce.ts`). */
export const REDUCE_WORKGROUP = 8
const STRIDE_MASK = FEEDBACK_STRIDE - 1

export const REDUCE_WGSL = `struct ReduceUni{size:vec2u,feedback:u32,pad:u32,}
@group(0) @binding(0) var requests:texture_2d<u32>;
@group(0) @binding(1) var<storage,read_write> tileFeedback:array<atomic<u32>>;
@group(0) @binding(2) var<uniform> uni:ReduceUni;
@compute @workgroup_size(${REDUCE_WORKGROUP},${REDUCE_WORKGROUP}) fn reduce(@builtin(global_invocation_id) id:vec3u){
 var p=id.xy;
 if((uni.feedback&${FEEDBACK_EVERY}u)==0u){p=p*${FEEDBACK_STRIDE}u+vec2u(uni.feedback&${STRIDE_MASK}u,(uni.feedback>>2u)&${STRIDE_MASK}u);}
 if(p.x>=uni.size.x||p.y>=uni.size.y){return;}
 let request=textureLoad(requests,p,0).r;
 if(request!=0u){atomicAdd(&tileFeedback[request-1u],1u);}
}`
