import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { BEER_BUILD_WGSL } from './beerShadowMapWgsl.ts'
import { AVSM_LIST_EDIT_WGSL } from './volumetricShadow/avsmListEditWgsl.ts'
import { AVSM_WGSL } from './volumetricShadow/avsmWgsl.ts'

/** The bytes of the adaptive map's parameters (`HvAvsmParams`). */
export const HV_AVSM_PARAMS_BYTES = 16

/** What the build of the adaptive map keeps of the settings: the samples a texel holds at most, whether the samples are compressed as they are made,
 *  and the absolute and relative errors under which one is dropped. */
const HV_AVSM_PARAMS = wgslStruct(
  'HvAvsmParams',
  [],
  `struct HvAvsmParams{maxSampleCount:i32,compress:i32,absoluteError:f32,relativeError:f32,}`,
)

/**
 * THE BUILDING OF THE ADAPTIVE VOLUMETRIC SHADOW MAP BY ONE VOLUME (RenderVolumetricShadowMapForLightWithLiveShadingCS, the adaptive type,
 * HeterogeneousVolumesLiveShadingShadows.usf:324-647): a thread a texel of a face, the ray of the light through it marched through the volume
 * with the volume's shadow step like the beer map's, and a sample (the distance, the luminance of the transmittance) added to the texel's linked
 * list whenever the transmittance leaves the line the last sample's extinction would have kept it on by more than both errors. A list ends with
 * the transmittance at the last place with extinction; a ray that meets the volume nowhere is a list of one sample at distance 0. The program
 * declares avsmList (the read-write storage array of two-word entries, a run of maxSampleCount entries a texel), avsmParams (a uniform of
 * HvAvsmParams) and what the beer map's build declares.
 */
export const HV_AVSM_BUILD_WGSL = wgslBlock(
  'HV_AVSM_BUILD_WGSL',
  [HV_AVSM_PARAMS, AVSM_WGSL, AVSM_LIST_EDIT_WGSL, BEER_BUILD_WGSL],
  `
@compute @workgroup_size(8,8,1)
fn hvAvsmShadowMain(@builtin(global_invocation_id) id:vec3u){
 hvInit();
 if(id.x>=hvShadow.info.z||id.y>=hvShadow.info.z||id.z>=hvShadow.info.x){return;}
 let face=id.z;
 let resolution=vec2i(i32(hvShadow.info.z));
 let pixel=i32(avsmLinearIndex(face,id.xy,resolution))*avsmParams.maxSampleCount;
 let uv=(vec2f(id.xy)+vec2f(0.5))/vec2f(f32(hvShadow.info.z));
 let ray=beerRayOf(face,uv);
 let worldOrigin=ray[0];
 let worldDirection=ray[1];
 let worldEnd=worldOrigin+worldDirection*hv.limits.x;
 let localOrigin=(hv.worldToLocal*vec4f(worldOrigin,1.0)).xyz;
 let localEnd=(hv.worldToLocal*vec4f(worldEnd,1.0)).xyz;
 var localDirection=localEnd-localOrigin;
 let localLength=length(localDirection);
 localDirection/=localLength;
 let span=hvIntersectAabb(localOrigin,localDirection,0.0,localLength,hv.boundsOrigin.xyz-hv.boundsExtent.xyz,hv.boundsOrigin.xyz+hv.boundsExtent.xyz);
 if(span.y-span.x<=0.0){
  var only=avsmListSetSample(vec2u(0u),avsmSample(0.0,1.0));
  only=avsmListSetPrev(only,AVSM_NULL_PTR);
  avsmList[pixel]=avsmListSetNext(only,AVSM_NULL_PTR);
  return;
 }
 let jitter=select(0.0,hvBlueNoise(id.xy),hv.limits.w>0.5);
 var marching=hvMakeRay(localOrigin,localDirection,span.x,span.y,worldOrigin,worldDirection,jitter,hvShadowStepSize(localDirection),u32(hv.limits.z),false,false);
 let count=hvStepCount(&marching);
 var step=marching.stepSize;
 let jitterSize=step*jitter;
 let compress=avsmParams.compress!=0;
 var transmittance=vec3f(1.0);
 var expectedExtinction=vec3f(0.0);
 var expectedTransmittance=vec3f(1.0);
 var prevElement=i32(AVSM_NULL_PTR);
 var element=0;
 var lastWorldT=span.x*marching.toWorldScale;
 for(var i=0u;i<count;i++){
  let localT=min(span.x+marching.stepSize*(jitter+f32(i)),span.y);
  if(i==count-1u){step=span.y-(localT-jitterSize);}
  let worldT=localT*marching.toWorldScale;
  let extinction=hvSampleExtinction(localOrigin+localDirection*localT,worldOrigin+worldDirection*worldT);
  transmittance*=exp(-extinction*step);
  if(any(extinction>vec3f(0.0))){
   lastWorldT=worldT;
   let grey=dot(transmittance,vec3f(0.2126,0.7152,0.0722));
   if(element==0){
    avsmAddSample(avsmSample(worldT,grey),pixel,&prevElement,&element);
    expectedExtinction=extinction;
    expectedTransmittance=transmittance;
   }else{
    // A sample is kept when the transmittance has left the line the last sample's extinction would have followed.
    expectedTransmittance*=exp(-expectedExtinction*step);
    let absoluteError=length(transmittance-expectedTransmittance);
    let relativeError=length((transmittance-expectedTransmittance)/expectedTransmittance);
    if(absoluteError>avsmParams.absoluteError&&relativeError>avsmParams.relativeError){
     avsmAddOrReplaceSample(avsmSample(worldT,grey),pixel,avsmParams.maxSampleCount,compress,&prevElement,&element);
     expectedExtinction=extinction;
     expectedTransmittance=transmittance;
    }
   }
  }
  if(all(transmittance<vec3f(1.0e-7))){transmittance=vec3f(0.0);break;}
 }
 // Stitch up the previous entry and end the list with the transmittance at the last place with extinction.
 if(prevElement!=i32(AVSM_NULL_PTR)){
  avsmList[pixel+prevElement]=avsmListSetNext(avsmList[pixel+prevElement],u32(element));
 }
 var last=avsmListSetSample(vec2u(0u),avsmSample(lastWorldT,dot(transmittance,vec3f(0.2126,0.7152,0.0722))));
 last=avsmListSetPrev(last,u32(prevElement));
 avsmList[pixel+element]=avsmListSetNext(last,AVSM_NULL_PTR);
}
`,
)
