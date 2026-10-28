import { sinFromCosUnclamped } from '../../../math/src/wgsl/geometry.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../math/src/wgsl/constants.ts'
import { r2Sequence } from '../../../math/src/wgsl/sampling.ts'
import { HAIR_BSDF_WGSL, HAIR_COMPONENT, HAIR_TRANSMITTANCE_FLAG } from './hairBsdfWgsl.ts'

/** The threads of a workgroup of the table's pass: a cube of this side (64 threads). */
export const HAIR_LUT_GROUP = 4
/** The format of the table: front scattering in x, back scattering in y. */
export const HAIR_LUT_FORMAT: GPUTextureFormat = 'rgba16float'

/**
 * THE TABLE OF THE FIBRE'S AVERAGE SCATTERING, a texel for each angle of the light along the fibre (the sine, x),
 * roughness (y) and absorption (z, a perceptual one, the square root of the absorption the strand holds): the
 * hair BSDF (`HAIR_BSDF_WGSL`) of a fibre of that colour seen from that angle, integrated over the sphere of
 * lights by a stratified sampling (the R2 sequence for the jitter), the half of the sphere the eye is on
 * (x of the light positive: the back, where R and TRT lie) apart from the other (the front, where TT lies),
 * each averaged and halved: x holds the front, y the back. The material is the table's own (no diffuse, a
 * specular of 0.5, the backlit whole) and the components R, TT and TRT with the separable R and the BSDF not
 * clamped. `sampleScale` multiplies the samples of an axis (the reference's 1).
 */
export const HAIR_LUT_WGSL = wgslProgram(
  `struct LutParams{angles:u32,roughnesses:u32,absorptions:u32,sampleScale:u32}
@group(0) @binding(0) var<uniform> params:LutParams;
@group(0) @binding(1) var lut:texture_storage_3d<${HAIR_LUT_FORMAT},write>;
// A direction of the sphere by two numbers of [0, 1), and its density.
fn uniformSphere(e:vec2f)->vec4f{
 let phi=2.0*PI*e.x;
 let cosTheta=1.0-2.0*e.y;
 let sinTheta=sinFromCosUnclamped(cosTheta);
 return vec4f(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta,1.0/(4.0*PI));
}
@compute @workgroup_size(${HAIR_LUT_GROUP},${HAIR_LUT_GROUP},${HAIR_LUT_GROUP}) fn hairLut(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(params.angles,params.roughnesses,params.absorptions))){return;}
 let sinAngle=saturate((f32(id.x)+0.5)/f32(params.angles));
 let roughness=saturate((f32(id.y)+0.5)/f32(params.roughnesses));
 let absorption=saturate((f32(id.z)+0.5)/f32(params.absorptions));
 let cosAngle=sinFromCosUnclamped(sinAngle);
 // The perceptual absorption, as the colour that holds it.
 let base=vec3f(absorption*absorption);
 let thetaCount=max(1u,u32(f32(params.sampleScale)*mix(128.0,64.0,roughness)));
 let phiCount=max(1u,u32(f32(params.sampleScale)*mix(128.0,32.0,roughness)));
 let n=vec3f(0.0,0.0,1.0);
 let v=vec3f(cosAngle,0.0,sinAngle);
 var td=hairStrandsTransmittanceInit(true);
 td.components=${HAIR_COMPONENT.r | HAIR_COMPONENT.tt | HAIR_COMPONENT.trt}u;
 td.flags=td.flags&~${HAIR_TRANSMITTANCE_FLAG.clampBsdf}u;
 var front=0.0;
 var back=0.0;
 var frontCount=0u;
 var backCount=0u;
 for(var y=0u;y<phiCount;y++){
  for(var x=0u;x<thetaCount;x++){
   let jitter=r2Sequence(x+y*thetaCount);
   let u=(vec2f(f32(x),f32(y))+jitter)/vec2f(f32(thetaCount),f32(phiCount));
   let sampleDirection=uniformSphere(u.yx);
   let value=hairShading(base,roughness,0.5,0.0,1.0,sampleDirection.xyz,v,n,1.0,td,1.0,0.0).x/sampleDirection.w;
   if(sampleDirection.x>0.0){back+=value;backCount++;}
   else{front+=value;frontCount++;}
  }
 }
 let hemisphereFactor=0.5;
 textureStore(lut,id,vec4f(saturate(front/f32(max(frontCount,1u))*hemisphereFactor),saturate(back/f32(max(backCount,1u))*hemisphereFactor),0.0,1.0));
}`,
  [HAIR_BSDF_WGSL, PI, r2Sequence, sinFromCosUnclamped],
)
