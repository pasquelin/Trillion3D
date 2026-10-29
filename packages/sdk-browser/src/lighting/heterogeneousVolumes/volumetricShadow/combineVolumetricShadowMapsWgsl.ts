import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { AVSM_PARAMS_STRUCT } from './convertBeerToAvsmWgsl.ts'
import { AVSM_LIST_EDIT_WGSL } from './avsmListEditWgsl.ts'
import { AVSM_WGSL } from './avsmWgsl.ts'

/**
 * TWO SHADOW MAPS' LINKED LISTS COMBINED into one, texel by texel: their samples are taken in the order of their distance, each carrying the
 * transmittance the other list has by then, so that the one list is the transmittance of both volumes together. A sample is added to the
 * output while it has room; when it has none, the sample whose removal marks the least error is replaced (`params.compress`), else the last
 * one is overwritten.
 *
 * Bindings: 0 the parameters (uniform), 1 the first list (storage, read), 2 the second list (storage, read), 3 the combined list (storage).
 * Dispatch: a group per 8 x 8 texels, the faces along z.
 */
export const AVSM_COMBINE_WGSL = wgslProgram(
  `${AVSM_PARAMS_STRUCT}
@group(0) @binding(0) var<uniform> params:AvsmParams;
@group(0) @binding(1) var<storage,read> listA:array<vec2u>;
@group(0) @binding(2) var<storage,read> listB:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> avsmList:array<vec2u>;

@compute @workgroup_size(8,8,1)
fn combineVolumetricShadowMaps(@builtin(global_invocation_id) id:vec3u){
 let pixel=id.xy;
 if(any(vec2i(pixel)>=params.resolution)){return;}
 let start=i32(avsmLinearIndex(id.z,pixel,params.resolution))*params.maxSampleCount;
 let compress=params.compress!=0;
 var prev=i32(AVSM_NULL_PTR);
 var next=0;
 var transmittanceA=1.0;
 var transmittanceB=1.0;
 var linkA=0u;
 var linkB=0u;
 // The samples of both lists in the order of their distance, each scaled by what the other list has let through by then.
 for(var hops=0;hops<512&&linkA!=AVSM_NULL_PTR&&linkB!=AVSM_NULL_PTR;hops++){
  let a=avsmListSample(listA[start+i32(linkA)]);
  let b=avsmListSample(listB[start+i32(linkB)]);
  var insert:AvsmSample;
  if(a.x<b.x){
   insert=AvsmSample(a.x,a.tau*transmittanceB);
   transmittanceA=a.tau;
   linkA=avsmListNext(listA[start+i32(linkA)]);
  }else{
   insert=AvsmSample(b.x,b.tau*transmittanceA);
   transmittanceB=b.tau;
   linkB=avsmListNext(listB[start+i32(linkB)]);
  }
  avsmAddOrReplaceSample(insert,start,params.maxSampleCount,compress,&prev,&next);
 }
 for(var hops=0;hops<256&&linkA!=AVSM_NULL_PTR;hops++){
  let a=avsmListSample(listA[start+i32(linkA)]);
  linkA=avsmListNext(listA[start+i32(linkA)]);
  avsmAddOrReplaceSample(AvsmSample(a.x,a.tau*transmittanceB),start,params.maxSampleCount,compress,&prev,&next);
 }
 for(var hops=0;hops<256&&linkB!=AVSM_NULL_PTR;hops++){
  let b=avsmListSample(listB[start+i32(linkB)]);
  linkB=avsmListNext(listB[start+i32(linkB)]);
  avsmAddOrReplaceSample(AvsmSample(b.x,b.tau*transmittanceA),start,params.maxSampleCount,compress,&prev,&next);
 }
 // The last sample ends the list.
 if(prev!=i32(AVSM_NULL_PTR)){
  avsmList[start+prev]=avsmListSetNext(avsmList[start+prev],AVSM_NULL_PTR);
 }
}`,
  [AVSM_WGSL, AVSM_LIST_EDIT_WGSL],
)
