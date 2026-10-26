import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { unprojectPoint } from '../../../../math/src/wgsl/projection.ts'
import { VSM_CM_PER_UNIT } from '../../lighting/shadows/vsm/constants.ts'
import { WATER_PARAMS_WGSL } from './waterLayout.ts'

/**
 * THE WATER'S PURE READS, on the uniform `water` (`WaterParams`) that the module declares at its
 * own group: the refraction law, the phase function of the water's scattering, the dielectric's
 * index from its reflectance, the packed refraction mask, the world point of a pixel at a depth and
 * the linear depth of a point of the depth buffer.
 *
 * - `waterRefract` is the refracted direction of the eye vector `V` through a surface of normal `N`
 *   and relative index `eta`, `w` 1; the reflected one and `w` 0 under a total internal reflection.
 * - `waterPhase` is Schlick's approximation of the Henyey-Greenstein phase function of the medium's
 *   anisotropy `g` (-1 to 1), normalised over the sphere.
 * - The mask packs a flag (bit 8) and the share of the refraction kept (the seven bits below) in a
 *   unorm byte (`waterMaskPack`).
 * - `waterWorldAt` is the world point of the pixel `pixel` of a target of `size` whose linear depth is
 *   `depth`: the pixel's ray through two depths of the inverse projection, the point where the clip w
 *   is the depth. `waterLinearDepth` is that depth for a device depth `z` (the clip w; far, for the
 *   background's 0).
 */
export const WATER_MATH_WGSL = wgslBlock(
  'WATER_MATH_WGSL',
  [WATER_PARAMS_WGSL, PI, unprojectPoint],
  `const WATER_CM:f32=${VSM_CM_PER_UNIT}.0;
const WATER_MASK_IS_WATER:f32=128.0/255.0;
const WATER_MASK_REFRACTION:f32=127.0/255.0;
const WATER_FAR:f32=1e30;
fn waterRefract(V:vec3f,N:vec3f,eta:f32)->vec4f{
 let cosI=dot(V,N);
 let cosT2=1.0-eta*eta*(1.0-cosI*cosI);
 if(cosT2<0.0){return vec4f(reflect(-V,N),0.0);}
 let cosT=-select(-1.0,1.0,cosI>=0.0)*sqrt(cosT2);
 return vec4f((eta*cosI+cosT)*N-eta*V,1.0);
}
fn waterPhase(g:f32,cosTheta:f32)->f32{
 let k=1.55*g-0.55*g*g*g;
 let t=1.0+k*cosTheta;
 return (1.0-k*k)/(4.0*PI*t*t);
}
fn waterIor(f0:f32)->f32{return 2.0/(1.0-sqrt(min(f0,0.99)))-1.0;}
fn waterMaskPack(isWater:bool,share:f32)->f32{
 return select(0.0,saturate(share)*WATER_MASK_REFRACTION+WATER_MASK_IS_WATER,isWater);
}
fn waterNdc(pixel:vec2f,size:vec2f)->vec2f{return vec2f(pixel.x/size.x*2.0-1.0,1.0-pixel.y/size.y*2.0);}
fn waterWorldAt(pixel:vec2f,size:vec2f,depth:f32)->vec3f{
 let ndc=waterNdc(pixel,size);
 let a=unprojectPoint(water.inverseViewProjection,vec3f(ndc,1.0));
 let b=unprojectPoint(water.inverseViewProjection,vec3f(ndc,0.5));
 let clipA=dot(water.clipW,vec4f(a,1.0));
 let slope=dot(water.clipW.xyz,b-a);
 return a+(b-a)*((depth-clipA)/select(slope,1e-12,abs(slope)<1e-12));
}
fn waterLinearDepth(pixel:vec2f,size:vec2f,z:f32)->f32{
 if(z<=0.0){return WATER_FAR;}
 let p=unprojectPoint(water.inverseViewProjection,vec3f(waterNdc(pixel,size),z));
 return min(dot(water.clipW,vec4f(p,1.0)),WATER_FAR);
}
`,
)
