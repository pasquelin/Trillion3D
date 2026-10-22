import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { IRRADIANCE_SIDE, IRRADIANCE_VECTORS } from './layout.ts'
import { SKY_CUBE_WGSL, SKY_SAMPLING_WGSL } from './cubeWgsl.ts'

/**
 * THE SKY LIGHT'S DIFFUSE LIGHT, summed from the filtered cube into nine harmonics by one group of
 * `IRRADIANCE_SIDE` squared threads: a thread reads the cube, at the mip the block names
 * (`irradianceMip`) and the nearest texel, along one of that many directions spread evenly over
 * the sphere, the cell `(thread + 0.5) / side` of the unit square, and adds its radiance times the
 * basis and the share of the sphere a direction stands for (4π over the count) for each of the
 * three channels. The sums of the threads are added pairwise, the second half of the array onto
 * the first, 64 to 1.
 *
 * The result is written, packed so that the light of a normal costs the fewest operations
 * (`skyHarmonicsIrradiance`, `read.ts`): the cosine lobe's weights are in the coefficients.
 * `irradiance` is `IRRADIANCE_VECTORS` vec4s: three that hold the first band and the quadratic
 * term's constant of each channel (red, green, blue), three the quadratic terms of each, and one
 * the last term of the three channels and 1. No mean brightness of the cube is kept: only a
 * surface lit by baked light weighs its reflections by it, and no surface here is.
 * The sums are added in the order above whatever the device's scheduling.
 */
const IRRADIANCE_OWN = `struct IrradianceBlock{mip:u32,}
@group(0) @binding(0) var<uniform> block:IrradianceBlock;
@group(0) @binding(1) var source:texture_cube<f32>;
@group(0) @binding(2) var nearest:sampler;
@group(0) @binding(3) var<storage,read_write> irradiance:array<vec4f,${IRRADIANCE_VECTORS}>;
const SIDE:u32=${IRRADIANCE_SIDE}u;
const THREADS:u32=${IRRADIANCE_SIDE * IRRADIANCE_SIDE}u;
/** The nine harmonics of one thread: a coefficient a vector of the three channels. */
var<workgroup> sums:array<array<vec3f,9>,${IRRADIANCE_SIDE * IRRADIANCE_SIDE}>;
fn addSums(sink:u32,part:u32){
 for(var k=0u;k<9u;k++){sums[sink][k]+=sums[part][k];}
}
@compute @workgroup_size(${IRRADIANCE_SIDE},${IRRADIANCE_SIDE},1)
fn irradianceMain(@builtin(local_invocation_id) id:vec3u){
 let at=SIDE*id.y+id.x;
 let d=sampleSphereEven((vec2f(id.xy)+0.5)/f32(SIDE));
 let radiance=textureSampleLevel(source,nearest,d,f32(block.mip)).rgb*(4.0*PI/f32(THREADS));
 let basis=harmonicsBasis(d);
 let terms=array<f32,9>(basis.low.x,basis.low.y,basis.low.z,basis.low.w,basis.mid.x,basis.mid.y,basis.mid.z,basis.mid.w,basis.high);
 for(var k=0u;k<9u;k++){sums[at][k]=radiance*terms[k];}
 workgroupBarrier();
 for(var stride=THREADS/2u;stride>0u;stride=stride>>1u){
  if(at<stride){addSums(at,at+stride);}
  workgroupBarrier();
 }
 if(at==0u){
  let s=sums[0];
  let sqrtPi=sqrt(PI);
  let c0=1.0/(2.0*sqrtPi);
  let c1=sqrt(3.0)/(3.0*sqrtPi);
  let c2=sqrt(15.0)/(8.0*sqrtPi);
  let c3=sqrt(5.0)/(16.0*sqrtPi);
  let c4=0.5*c2;
  for(var c=0u;c<3u;c++){
   irradiance[c]=vec4f(-c1*s[3][c],-c1*s[1][c],c1*s[2][c],c0*s[0][c]-c3*s[6][c]);
   irradiance[3u+c]=vec4f(c2*s[4][c],-c2*s[5][c],3.0*c3*s[6][c],-c2*s[7][c]);
  }
  irradiance[6]=vec4f(c4*s[8],1.0);
 }
}`

/** The harmonics' program (`IRRADIANCE_ENTRY`). */
export const IRRADIANCE_CODE = wgslProgram(IRRADIANCE_OWN, [PI, SKY_CUBE_WGSL, SKY_SAMPLING_WGSL])
export const IRRADIANCE_ENTRY = 'irradianceMain'
