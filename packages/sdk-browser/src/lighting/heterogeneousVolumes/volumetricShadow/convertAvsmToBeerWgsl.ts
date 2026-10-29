import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { AVSM_PARAMS_STRUCT } from './convertBeerToAvsmWgsl.ts'
import { AVSM_WGSL } from './avsmWgsl.ts'

/**
 * AN ADAPTIVE VOLUMETRIC SHADOW MAP AS A BEER SHADOW MAP: each texel's list is read from its first sample to its last, and the first and last
 * of them, with the transmittance at each, make the texel (distance and transmittance, near then far; a list of one has its far sample
 * at distance 0 and transmittance 1). The faces lie side by side in the strip.
 *
 * Bindings: 0 the parameters (uniform), 1 the linked lists (storage, read), 2 the Beer strip (storage texture of `format`, written).
 * Dispatch: a group per 8 x 8 texels, the faces along z.
 */
export const avsmConvertToBeerProgram = (format: 'rgba16float' | 'rgba32float') =>
  wgslProgram(
    `${AVSM_PARAMS_STRUCT}
@group(0) @binding(0) var<uniform> params:AvsmParams;
@group(0) @binding(1) var<storage,read> avsmLists:array<vec2u>;
@group(0) @binding(2) var beerMap:texture_storage_2d<${format},write>;

@compute @workgroup_size(8,8,1)
fn convertVolumetricShadowMapToBeerLawShadowMap(@builtin(global_invocation_id) id:vec3u){
 let pixel=id.xy;
 if(any(vec2i(pixel)>=params.resolution)){return;}
 let start=i32(avsmLinearIndex(id.z,pixel,params.resolution))*params.maxSampleCount;
 let first=avsmListSample(avsmLists[start]);
 var far=avsmSample(0.0,1.0);
 var link=avsmListNext(avsmLists[start]);
 for(var hops=0;hops<256&&link!=AVSM_NULL_PTR;hops++){
  far=avsmListSample(avsmLists[start+i32(link)]);
  link=avsmListNext(avsmLists[start+i32(link)]);
 }
 textureStore(beerMap,vec2i(vec2u(id.z*u32(params.resolution.x)+pixel.x,pixel.y)),vec4f(first.x,far.x,first.tau,far.tau));
}`,
    [AVSM_WGSL],
  )
