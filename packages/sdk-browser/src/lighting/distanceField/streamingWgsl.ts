import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { squaredDistanceBetweenBoxes } from './aabbWgsl.ts'
import { meshFieldWgsl } from './meshFieldWgsl.ts'

/**
 * WHAT THE GPU ASKS OF THE ATLAS EACH FRAME: for each mesh the mips its placements want, then the
 * meshes whose loaded mips differ from that, written as a list the host reads a frame or more
 * later (`streaming.ts`, `atlasRequests.ts`).
 *
 * A placement wants the coarsest mip, one if it is far; the second if its box meets the box of the
 * view's outer clipmap (the last of the clipmaps the field is asked to hold); the third if its box
 * meets the box of the clipmap half way in. A mesh wants the most any of its placements wants. The
 * request list is its count, then an asset and its wanted number of mips for each request, at most
 * `MAX_STREAMING_REQUESTS`; a mesh with no mip loaded yet is left to the host's first load.
 */

/** The block of the streaming passes. `forceMips` set, every placement wants that many mips. */
export const STREAM_BLOCK = fieldLayout('DfStream', [
  ['forceMips', 'u32'],
  ['maxRequests', 'u32'],
  ['assets', 'u32'],
  ['capacity', 'u32'],
  ['mip1Centre', 'vec3f'],
  ['padA', 'f32'],
  ['mip1Extent', 'vec3f'],
  ['padB', 'f32'],
  ['mip2Centre', 'vec3f'],
  ['padC', 'f32'],
  ['mip2Extent', 'vec3f'],
  ['padD', 'f32'],
  ['translationHigh', 'vec3f'],
  ['padE', 'f32'],
  ['translationLow', 'vec3f'],
  ['padF', 'f32'],
] as const)

/** The entries of the streaming passes. */
export const STREAM_ENTRIES = {
  clear: 'clearWantedMips',
  wanted: 'computeWantedMips',
  requests: 'generateStreamingRequests',
} as const

const LANES = WORKGROUP_THREADS

/** The streaming passes' program: the scene's bindings in group 0, its own in group 1. */
export const STREAMING_SHADER = wgslProgram(
  `${STREAM_BLOCK.wgsl}
@group(1) @binding(0) var<uniform> stream:DfStream;
@group(1) @binding(1) var<storage,read_write> wantedMips:array<atomic<u32>>;
@group(1) @binding(2) var<storage,read_write> requests:array<atomic<u32>>;
@compute @workgroup_size(${LANES}) fn ${STREAM_ENTRIES.clear}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(id,n,${LANES}u);
 if(index<stream.capacity){atomicStore(&wantedMips[index],1u);}
}
@compute @workgroup_size(${LANES}) fn ${STREAM_ENTRIES.wanted}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(id,n,${LANES}u);
 if(index==0u){atomicStore(&requests[0],0u);}
 if(index>=dfScene.objects){return;}
 var wanted=1u;
 if(stream.forceMips==0u){
  let bounds=loadDfObjectBounds(index);
  let centre=dfAddDemote(bounds.center,DfVec3(stream.translationHigh,stream.translationLow));
  if(squaredDistanceBetweenBoxes(stream.mip1Centre,stream.mip1Extent,centre,bounds.boxExtent)<=0.0){
   let inner=squaredDistanceBetweenBoxes(stream.mip2Centre,stream.mip2Extent,centre,bounds.boxExtent);
   wanted=select(2u,3u,inner<=0.0);
  }
 }else{wanted=stream.forceMips;}
 if(wanted>1u){atomicMax(&wantedMips[loadDfObjectData(index).asset],wanted);}
}
@compute @workgroup_size(${LANES}) fn ${STREAM_ENTRIES.requests}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let asset=flatIndex(id,n,${LANES}u);
 if(asset>=stream.assets){return;}
 let loaded=dfAssetMip(asset,0u).numMips;
 let wanted=atomicLoad(&wantedMips[asset]);
 if(wanted!=0u&&loaded!=0u&&loaded!=wanted){
  let at=atomicAdd(&requests[0],1u);
  if(at<stream.maxRequests){
   atomicStore(&requests[1u+at*2u],asset);
   atomicStore(&requests[2u+at*2u],wanted);
  }
 }
}`,
  [meshFieldWgsl(0), squaredDistanceBetweenBoxes, FLAT_INDEX_WGSL],
)
