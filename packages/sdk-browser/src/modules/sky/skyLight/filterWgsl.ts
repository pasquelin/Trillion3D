import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { FILTER_GROUP_SIDE, SKY_LIGHT_CUBE_FORMAT } from './layout.ts'
import { SKY_CUBE_WGSL, SKY_SAMPLING_WGSL } from './cubeWgsl.ts'

/**
 * THE CUBE'S MIPS AND THEIR FILTER, two compute programs over one layout: a block read at a
 * dynamic offset (`FilterBlock`), the cube read through a filtering sampler (bilinear for the
 * mips, trilinear for the roughness filter), and the texture written, one slice a face, at the mip the pass fills. A
 * thread is a texel of a face of that mip, the faces the dispatch's depth.
 *
 * - `downsampleMain` fills a mip from the one above it, the source bound as that one level: the
 *   texel's own direction and eight more around it, four on the diagonals at 0.7 of the offset,
 *   four on the axes, the offset `4 / side` of the mip; the first counts once and each of the
 *   eight three eighths, the sum over four.
 * - `convolveMain` fills a mip of the filtered cube from the captured cube's levels, the source
 *   bound whole. The mip stands for a roughness (`mipRoughness`): under 0.01 the texel is copied
 *   from the top level. Else the texel's direction `N` is the lobe's axis and the lobe is sampled
 *   `32` times under a roughness of 0.1, `64` above: over 0.99 the cosine lobe, else the GGX lobe
 *   (its half vectors, the second coordinate held to 0.995, weighted by the cosine with the
 *   light). Each sample reads the level its solid angle asks, half the log of its ratio to the
 *   texel's. No value written is negative or not a number.
 */
const FILTER_BLOCK = `struct FilterBlock{mip:u32,mips:u32,faceFirst:u32,spare:u32,}`

const FILTER_OWN = `${FILTER_BLOCK}
@group(0) @binding(0) var<uniform> block:FilterBlock;
@group(0) @binding(1) var source:texture_cube<f32>;
@group(0) @binding(2) var cubeSampler:sampler;
@group(0) @binding(3) var filtered:texture_storage_2d_array<${SKY_LIGHT_CUBE_FORMAT},write>;
fn sourceAt(d:vec3f,level:f32)->vec4f{return textureSampleLevel(source,cubeSampler,d,level);}
/** A value with no negative and no not-a-number in it. */
fn finiteAbove(v:vec4f)->vec4f{return -min(-v,vec4f(0.0));}
@compute @workgroup_size(${FILTER_GROUP_SIDE},${FILTER_GROUP_SIDE},1)
fn downsampleMain(@builtin(global_invocation_id) id:vec3u){
 let side=textureDimensions(filtered).x;
 if(id.x>=side||id.y>=side){return;}
 let face=id.z;
 let uv=(vec2f(id.xy)+0.5)/f32(side)*2.0-1.0;
 let d=faceDirection(uv,face);
 let z=normalize(d);
 let x=normalize(cross(faceDirection(uv+vec2f(0.0,1.0),face),z));
 let y=cross(z,x);
 let spread=4.0/f32(side);
 let offsets=array<vec2f,8>(
  vec2f(-0.7,-0.7),vec2f(0.7,-0.7),vec2f(-0.7,0.7),vec2f(0.7,0.7),
  vec2f(0.0,-1.0),vec2f(-1.0,0.0),vec2f(1.0,0.0),vec2f(0.0,1.0));
 var sum=sourceAt(d,0.0);
 for(var i=0u;i<8u;i++){
  sum+=sourceAt(d+x*(offsets[i].x*spread)+y*(offsets[i].y*spread),0.0)*0.375;
 }
 textureStore(filtered,id.xy,face,sum*0.25);
}
@compute @workgroup_size(${FILTER_GROUP_SIDE},${FILTER_GROUP_SIDE},1)
fn convolveMain(@builtin(global_invocation_id) id:vec3u){
 let side=textureDimensions(filtered).x;
 if(id.x>=side||id.y>=side){return;}
 let face=block.faceFirst+id.z;
 let uv=(vec2f(id.xy)+0.5)/f32(side)*2.0-1.0;
 let d=faceDirection(uv,face);
 let n=normalize(d);
 let frame=frameAround(n);
 let roughness=mipRoughness(f32(block.mip),f32(block.mips-1u));
 if(roughness<0.01){
  textureStore(filtered,id.xy,face,finiteAbove(sourceAt(d,0.0)));
  return;
 }
 let cubeSide=1u<<(block.mips-1u);
 let texelAngle=4.0*PI/f32(6u*cubeSide*cubeSide)*2.0;
 let count=select(64u,32u,roughness<0.1);
 var sum=vec4f(0.0);
 var result:vec4f;
 if(roughness>0.99){
  for(var i=0u;i<count;i++){
   let e=lowDiscrepancy(i,count);
   let l=sampleCosineHemisphere(e);
   let pdf=l.z/PI;
   let sampleAngle=1.0/(f32(count)*pdf);
   let level=0.5*log2(sampleAngle/texelAngle);
   sum+=sourceAt(outOfFrame(l,frame),level);
  }
  result=sum/f32(count);
 }else{
  var weight=0.0;
  let alpha2=pow(roughness,4.0);
  for(var i=0u;i<count;i++){
   var e=lowDiscrepancy(i,count);
   e.y*=0.995;
   let h=sampleGgxHalf(e,alpha2);
   let l=2.0*h.z*h-vec3f(0.0,0.0,1.0);
   if(l.z>0.0){
    let pdf=ggxDistribution(alpha2,h.z,dot(h.xy,h.xy))*0.25;
    let sampleAngle=1.0/(f32(count)*pdf);
    let level=0.5*log2(sampleAngle/texelAngle);
    sum+=sourceAt(outOfFrame(l,frame),level)*l.z;
    weight+=l.z;
   }
  }
  result=sum/weight;
 }
 textureStore(filtered,id.xy,face,finiteAbove(result));
}`

/** The filter's two programs' text (`downsampleMain`, `convolveMain`). */
export const FILTER_CODE = wgslProgram(FILTER_OWN, [PI, SKY_CUBE_WGSL, SKY_SAMPLING_WGSL])
export const FILTER_ENTRIES = { downsample: 'downsampleMain', convolve: 'convolveMain' } as const
