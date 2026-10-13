import { WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FEEDBACK_EVERY, FEEDBACK_STRIDE, FEEDBACK_STRIDE_MASK } from './feedback.ts'
import { TILE_STAMP_WGSL } from './stampWgsl.ts'

/** Phase pixels on one side of a workgroup of the reduction (`reduce.ts`). */
export const REDUCE_WORKGROUP = 8

/** The reduction: a pixel adds one to the counter of the tile it asks, and the pixel that finds it
 *  at zero stamps the place that tile's entry names as used this clock (`stampWgsl.ts`) — before
 *  the list's cap: a tile past it is read all the same — then lists the tile, if the list has room
 *  — else the counter is zeroed again, so that no tile is left counted and unlisted. The list is
 *  the feedback's (`feedback.ts`): its first word counts the listed tiles, `uni.cap` ranks follow. */
export const REDUCE_WGSL = wgslProgram(
  `struct ReduceUni{size:vec2u,feedback:u32,cap:u32,clock:u32,}
@group(0) @binding(0) var requests:texture_2d<u32>;
@group(0) @binding(1) var<storage,read_write> tileFeedback:array<atomic<u32>>;
@group(0) @binding(2) var<uniform> uni:ReduceUni;
@group(0) @binding(3) var<storage,read_write> hits:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read> colorPages:array<u32>;
@group(0) @binding(5) var<storage,read> dataPages:array<u32>;
@group(0) @binding(6) var<storage,read_write> colorUse:array<atomic<u32>>;
@group(0) @binding(7) var<storage,read_write> dataUse:array<atomic<u32>>;
@compute @workgroup_size(${REDUCE_WORKGROUP},${REDUCE_WORKGROUP}) fn reduce(@builtin(global_invocation_id) id:vec3u){
 var p=id.xy;
 if((uni.feedback&${FEEDBACK_EVERY}u)==0u){p=p*${FEEDBACK_STRIDE}u+vec2u(uni.feedback&${FEEDBACK_STRIDE_MASK}u,(uni.feedback>>2u)&${FEEDBACK_STRIDE_MASK}u);}
 if(p.x>=uni.size.x||p.y>=uni.size.y){return;}
 let request=textureLoad(requests,p,0).r;
 if(request==0u){return;}
 let rank=request-1u;
 if(atomicAdd(&tileFeedback[rank],1u)!=0u){return;}
 tileStampRank(rank,uni.clock);
 let at=atomicAdd(&hits[0],1u);
 if(at<uni.cap){atomicStore(&hits[1u+at],rank);}else{atomicStore(&tileFeedback[rank],0u);}
}`,
  [TILE_STAMP_WGSL],
)

/** The gather: each listed tile's count into the list's weights, its counter zeroed for the next
 *  image. */
export const GATHER_WGSL = wgslProgram(
  `struct GatherUni{cap:u32,}
@group(0) @binding(0) var<storage,read_write> tileFeedback:array<atomic<u32>>;
@group(0) @binding(1) var<storage,read_write> hits:array<atomic<u32>>;
@group(0) @binding(2) var<uniform> uni:GatherUni;
@compute @workgroup_size(WORKGROUP_THREADS) fn gather(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=min(atomicLoad(&hits[0]),uni.cap)){return;}
 let rank=atomicLoad(&hits[1u+id.x]);
 atomicStore(&hits[1u+uni.cap+id.x],atomicExchange(&tileFeedback[rank],0u));
}`,
  [WORKGROUP_THREADS_WGSL],
)
