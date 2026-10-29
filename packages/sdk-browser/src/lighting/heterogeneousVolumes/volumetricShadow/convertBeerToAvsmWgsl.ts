import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { AVSM_WGSL } from './avsmWgsl.ts'

/** The bytes of the parameters of the conversion passes and of compress and combine (`AvsmParams`). */
export const AVSM_PARAMS_BYTES = 32

/** The words of `AvsmParams`, the host's parameters of every pass that reads or writes a shadow map's lists. */
export const AVSM_PARAMS_STRUCT = `struct AvsmParams{
 resolution:vec2i,
 maxSampleCount:i32,
 compress:i32,
 absoluteError:f32,
 relativeError:f32,
 pad0:f32,
 pad1:f32,
}`

/**
 * A BEER SHADOW MAP AS AN ADAPTIVE VOLUMETRIC SHADOW MAP: each texel of the map (the distance of the first and of the last place with
 * extinction, and the transmittance at each) is two samples, packed into a fixed run of the atlas, one block of 8 x 8 texels taking its
 * block of the atlas with one allocation; the indirection entry gives the offset and the texel's range. The atlas run of a texel is its
 * top level (every fourth sample, here the first, padded to four) then its bottom level (the samples offset by one, padded to four).
 *
 * Bindings: 0 the parameters (uniform), 1 the Beer map (texture), 2 the allocator (storage, one word, cleared), 3 the indirection entries
 * (storage), 4 the atlas (storage). Dispatch: a group per 8 x 8 texels, the faces along z.
 */
export const AVSM_CONVERT_BEER_WGSL = wgslProgram(
  `${AVSM_PARAMS_STRUCT}
@group(0) @binding(0) var<uniform> params:AvsmParams;
@group(0) @binding(1) var beerMap:texture_2d<f32>;
@group(0) @binding(2) var<storage,read_write> allocator:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> indirection:array<vec4u>;
@group(0) @binding(4) var<storage,read_write> atlas:array<u32>;
var<workgroup> blockOffset:u32;

@compute @workgroup_size(8,8,1)
fn convertBeerLawShadowMapToVolumetricShadowMap(
 @builtin(global_invocation_id) id:vec3u,
 @builtin(local_invocation_index) threadIndex:u32){
 if(threadIndex==0u){blockOffset=AVSM_INVALID_PIXEL_OFFSET;}
 let pixel=id.xy;
 let linear=avsmLinearIndex(id.z,pixel,params.resolution);
 // The allocation is of a fixed size: two samples a texel.
 let bottomCount=2;
 let topCount=avsmTopLevelCount(bottomCount);
 let total=u32(avsmAlign4(topCount)+avsmAlign4(bottomCount));
 workgroupBarrier();
 if(threadIndex==0u){blockOffset=atomicAdd(&allocator[0],total*64u);}
 workgroupBarrier();
 if(any(vec2i(pixel)>=params.resolution)){return;}
 let topOffset=blockOffset+threadIndex*total;
 let bottomOffset=topOffset+u32(avsmAlign4(topCount));
 let beer=textureLoad(beerMap,vec2i(pixel),0);
 let ind=AvsmIndirection(topOffset,bottomCount,beer.r,beer.g);
 indirection[linear]=avsmPackIndirection(ind);
 var samples=array<AvsmSample,2>(avsmSample(beer.r,beer.b),avsmSample(beer.g,beer.a));
 for(var i=0;i<bottomCount;i++){
  // The bottom level is offset by one element: sample i lands at i-1, the first sample only in the top level.
  atlas[bottomOffset+u32(max(i-1,0))]=avsmPackSample(samples[i],ind);
  if(i%4==0){atlas[topOffset+u32(i/4)]=avsmPackSample(samples[i],ind);}
 }
 let last=avsmPackSample(avsmSample(samples[1].x,samples[1].tau),ind);
 for(var b=max(bottomCount-1,0);b<avsmAlign4(bottomCount);b++){atlas[bottomOffset+u32(b)]=last;}
 for(var t=topCount;t<avsmAlign4(topCount);t++){atlas[topOffset+u32(t)]=last;}
}`,
  [AVSM_WGSL],
)
