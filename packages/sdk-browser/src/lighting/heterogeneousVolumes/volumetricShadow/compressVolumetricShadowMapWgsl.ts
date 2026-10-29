import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { AVSM_PARAMS_STRUCT } from './convertBeerToAvsmWgsl.ts'
import { AVSM_WGSL } from './avsmWgsl.ts'

/**
 * A SHADOW MAP'S LINKED LISTS COMPRESSED into the two buffers a read uses:
 *
 * 1) a per-texel indirection entry: the offset of the texel's samples in the atlas, their count (64 at most) and the distance of the first
 *    and of the last;
 * 2) the atlas of transmittance functions, two levels for each texel: the top level every fourth sample, (z0, t0) (z4, t4) (z8, t8) ..., then
 *    the bottom level, the samples themselves offset by one so that a 4-wide load reads from the top-level sample's successor on; each
 *    level is padded with the last sample to a multiple of four.
 *
 * A block of 8 x 8 texels counts its samples, then each texel takes its offset from the sum of the counts of the texels before it, and the
 * block takes its run of the atlas with one allocation.
 *
 * Bindings: 0 the parameters (uniform), 1 the linked lists (storage, read), 2 the allocator (storage, one word, cleared), 3 the
 * indirection entries (storage), 4 the atlas (storage). Dispatch: a group per 8 x 8 texels, the faces along z.
 */
export const AVSM_COMPRESS_WGSL = wgslProgram(
  `${AVSM_PARAMS_STRUCT}
@group(0) @binding(0) var<uniform> params:AvsmParams;
@group(0) @binding(1) var<storage,read> avsmLists:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> allocator:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> indirection:array<vec4u>;
@group(0) @binding(4) var<storage,read_write> atlas:array<u32>;
var<workgroup> blockCounts:array<i32,64>;
var<workgroup> blockPrefix:array<i32,64>;
var<workgroup> blockOffset:u32;

@compute @workgroup_size(8,8,1)
fn compressVolumetricShadowMap(
 @builtin(global_invocation_id) id:vec3u,
 @builtin(local_invocation_index) threadIndex:u32){
 blockCounts[threadIndex]=0;
 if(threadIndex==0u){blockOffset=AVSM_INVALID_PIXEL_OFFSET;}
 let pixel=id.xy;
 let inside=all(vec2i(pixel)<params.resolution);
 let start=i32(avsmLinearIndex(id.z,pixel,params.resolution))*params.maxSampleCount;

 // The samples of the texel and the distance of its first and last.
 var count=0;
 var begin=avsmSample(0.0,1.0);
 var end=begin;
 if(inside){
  begin=avsmListSample(avsmLists[start]);
  end=begin;
  var link=avsmListNext(avsmLists[start]);
  count=select(1,0,link==AVSM_NULL_PTR);
  for(var hops=0;hops<256&&link!=AVSM_NULL_PTR;hops++){
   count++;
   end=avsmListSample(avsmLists[start+i32(link)]);
   link=avsmListNext(avsmLists[start+i32(link)]);
  }
 }

 // The top-level skip list and the samples, each padded to four.
 let topCount=avsmTopLevelCount(count);
 blockCounts[threadIndex]=avsmAlign4(topCount)+avsmAlign4(count);
 workgroupBarrier();
 var prefix=0;
 for(var t=0u;t<threadIndex;t++){prefix+=blockCounts[t];}
 blockPrefix[threadIndex]=prefix;
 workgroupBarrier();
 // One allocation for the whole block.
 let total=u32(blockPrefix[63]+blockCounts[63]);
 if(threadIndex==0u&&total>0u){blockOffset=atomicAdd(&allocator[0],total);}
 workgroupBarrier();

 let topOffset=blockOffset+u32(blockPrefix[threadIndex]);
 let bottomOffset=topOffset+u32(avsmAlign4(topCount));
 let ind=AvsmIndirection(topOffset,count,begin.x,end.x);
 if(inside){indirection[avsmLinearIndex(id.z,pixel,params.resolution)]=avsmPackIndirection(ind);}

 // Pack and fill.
 var data=avsmSample(0.0,1.0);
 var link=0u;
 for(var i=0;i<count;i++){
  data=avsmListSample(avsmLists[start+i32(link)]);
  link=avsmListNext(avsmLists[start+i32(link)]);
  atlas[bottomOffset+u32(max(i-1,0))]=avsmPackSample(data,ind);
  if(i%4==0){atlas[topOffset+u32(i/4)]=avsmPackSample(data,ind);}
 }
 let last=avsmPackSample(avsmSample(data.x,data.tau),ind);
 for(var b=max(count-1,0);b<avsmAlign4(count);b++){atlas[bottomOffset+u32(b)]=last;}
 for(var t=topCount;t<avsmAlign4(topCount);t++){atlas[topOffset+u32(t)]=last;}
}`,
  [AVSM_WGSL],
)
