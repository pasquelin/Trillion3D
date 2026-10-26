import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { CAPTURED_IRRADIANCE_SIDE, IRRADIANCE_SIDE, IRRADIANCE_VECTORS } from './layout.ts'
import { SKY_CUBE_WGSL, SKY_SAMPLING_WGSL } from './cubeWgsl.ts'

/**
 * THE SKY LIGHT'S DIFFUSE LIGHT, summed into nine harmonics by one group of `IRRADIANCE_SIDE`
 * squared threads, two ways over one binding layout, each reading the cube at the mip the block
 * names (`IrradianceBlock`):
 * - `irradianceMain`, the real-time capture's, sums the filtered cube (`irradianceMip`): a thread
 *   reads the nearest texel along one of that many directions spread evenly over the sphere, the
 *   cell `(thread + 0.5) / side` of the unit square, and adds its radiance times the basis and the
 *   share of the sphere a direction stands for (4π over the count) for each of the three channels;
 * - `capturedIrradianceMain`, the captured scene's and the specified cubemap's, sums the captured
 *   cube's mips, before the filter (`capturedIrradianceMip`): the mip of side
 *   `CAPTURED_IRRADIANCE_SIDE`, or the top one where the cube is smaller, read bilinearly at the
 *   centre of each texel of a grid of that side on every face. A texel counts for the share of the
 *   sphere its cell stands for, `4 / (1 + u² + v²)^1.5` at the cell's `(u, v)` in `[-1, 1]`, and a
 *   coefficient is `4π` times the sum of the radiance times the basis and that share, over the sum
 *   of the shares. The cube's alpha is 1 there: its colour is already premultiplied by it.
 * The sums of the threads are added pairwise, the second half of the array onto the first, 64 to 1.
 *
 * The result is written, packed so that the light of a normal costs the fewest operations
 * (`skyHarmonicsIrradiance`, `read.ts`): the cosine lobe's weights are in the coefficients.
 * `irradiance` is `IRRADIANCE_VECTORS` vec4s: three that hold the first band and the quadratic
 * term's constant of each channel (red, green, blue), three the quadratic terms of each, and one
 * the last term of the three channels and 1. No mean brightness of the cube is kept (an eighth
 * vector): the one reader that uses it weighs the reflections of a surface lit by baked light — a
 * lightmap, or the volumetric lightmap read at the surface — by it, under a sky light that is not
 * movable; the volumetric lightmap here lights the volumetric fog alone (`lighting/fog/staticPass.ts`),
 * no surface, so none has a baked light to be mixed with.
 * The sums are added in the order above whatever the device's scheduling.
 */
const IRRADIANCE_OWN = `struct IrradianceBlock{mip:u32,}
@group(0) @binding(0) var<uniform> block:IrradianceBlock;
@group(0) @binding(1) var source:texture_cube<f32>;
@group(0) @binding(2) var cubeSampler:sampler;
@group(0) @binding(3) var<storage,read_write> irradiance:array<vec4f,${IRRADIANCE_VECTORS}>;
const SIDE:u32=${IRRADIANCE_SIDE}u;
const THREADS:u32=${IRRADIANCE_SIDE * IRRADIANCE_SIDE}u;
const GRID:u32=${CAPTURED_IRRADIANCE_SIDE}u;
const PER_THREAD:u32=6u*GRID*GRID/THREADS;
/** The nine harmonics of one thread: a coefficient a vector of the three channels; and the share of
 *  the sphere the thread's texels stand for. */
var<workgroup> sums:array<array<vec3f,9>,${IRRADIANCE_SIDE * IRRADIANCE_SIDE}>;
var<workgroup> weights:array<f32,${IRRADIANCE_SIDE * IRRADIANCE_SIDE}>;
fn termsOf(d:vec3f)->array<f32,9>{
 let basis=harmonicsBasis(d);
 return array<f32,9>(basis.low.x,basis.low.y,basis.low.z,basis.low.w,basis.mid.x,basis.mid.y,basis.mid.z,basis.mid.w,basis.high);
}
/** The threads' sums added pairwise, the second half onto the first, until thread 0 holds all. */
fn sumThreads(at:u32){
 workgroupBarrier();
 for(var stride=THREADS/2u;stride>0u;stride=stride>>1u){
  if(at<stride){
   for(var k=0u;k<9u;k++){sums[at][k]+=sums[at+stride][k];}
   weights[at]+=weights[at+stride];
  }
  workgroupBarrier();
 }
}
/** The harmonics \`s\`, packed for the light's read. */
fn packHarmonics(s:array<vec3f,9>){
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
@compute @workgroup_size(${IRRADIANCE_SIDE},${IRRADIANCE_SIDE},1)
fn irradianceMain(@builtin(local_invocation_id) id:vec3u){
 let at=SIDE*id.y+id.x;
 let d=sampleSphereEven((vec2f(id.xy)+0.5)/f32(SIDE));
 let radiance=textureSampleLevel(source,cubeSampler,d,f32(block.mip)).rgb*(4.0*PI/f32(THREADS));
 let terms=termsOf(d);
 for(var k=0u;k<9u;k++){sums[at][k]=radiance*terms[k];}
 sumThreads(at);
 if(at==0u){packHarmonics(sums[0]);}
}
@compute @workgroup_size(${IRRADIANCE_SIDE},${IRRADIANCE_SIDE},1)
fn capturedIrradianceMain(@builtin(local_invocation_id) id:vec3u){
 let at=SIDE*id.y+id.x;
 var acc:array<vec3f,9>;
 var weight=0.0;
 for(var i=0u;i<PER_THREAD;i++){
  let n=i*THREADS+at;
  let cell=n%(GRID*GRID);
  let uv=(vec2f(f32(cell%GRID),f32(cell/GRID))+0.5)/f32(GRID)*2.0-1.0;
  let squared=1.0+dot(uv,uv);
  let share=4.0/(sqrt(squared)*squared);
  let d=normalize(faceDirection(uv,n/(GRID*GRID)));
  let radiance=textureSampleLevel(source,cubeSampler,d,f32(block.mip)).rgb*share;
  let terms=termsOf(d);
  for(var k=0u;k<9u;k++){acc[k]+=radiance*terms[k];}
  weight+=share;
 }
 sums[at]=acc;
 weights[at]=weight;
 sumThreads(at);
 if(at==0u){
  var s=sums[0];
  let scale=4.0*PI/max(weights[0],0.00001);
  for(var k=0u;k<9u;k++){s[k]*=scale;}
  packHarmonics(s);
 }
}`

/** The harmonics' programs (`IRRADIANCE_ENTRIES`). */
export const IRRADIANCE_CODE = wgslProgram(IRRADIANCE_OWN, [PI, SKY_CUBE_WGSL, SKY_SAMPLING_WGSL])
export const IRRADIANCE_ENTRIES = {
  filtered: 'irradianceMain',
  captured: 'capturedIrradianceMain',
} as const
