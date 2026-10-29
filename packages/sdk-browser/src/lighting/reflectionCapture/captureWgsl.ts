import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { HALF_MAX, PI } from '../../../../math/src/wgsl/constants.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { SKY_LIGHT_CUBE_FORMAT, FILTER_GROUP_SIDE } from '../../modules/sky/skyLight/layout.ts'
import { SKY_CUBE_WGSL, SKY_SAMPLING_WGSL } from '../../modules/sky/skyLight/cubeWgsl.ts'
import { IRRADIANCE_VECTORS } from '../../modules/sky/skyLight/layout.ts'

/**
 * THE PROGRAMS THAT MAKE A REFLECTION CAPTURE'S CUBE, beside the sky light's mips and filter (`modules/sky/skyLight/filterWgsl.ts`),
 * which the capture reuses:
 * - `copyCaptureFaceMain` writes a face of the captured cube from the lit image of the scene drawn for it: the image turned as the sky
 *   light's copy does (`copySceneFaceMain`), held to the half float's range, and its alpha — 1, or, under a sky light that is not static,
 *   faded out past the sky light's distance threshold (from 0.8 of it, smoothly) so that the capture covers nothing where it holds the
 *   sky and the sky light shows there — with the colour multiplied by the alpha (the cube's colour is premultiplied before its mips are
 *   made). The radial distance of a pixel is the depth along the axis, `near / z` for the reversed infinite projection, times the length
 *   of the pixel's ray;
 * - `shCubeMain` writes the cube's smallest mips from the nine harmonics of the capture (`irradiance`, the packed form the sky light
 *   reads): the diffuse light along the texel's direction, the harmonics' evaluation with the cosine lobe in their weights. The
 *   reference evaluates the harmonics alone (the radiance they hold, with no cosine lobe) and reads the result as irradiance, which is the
 *   light of the whole sphere, not of the hemisphere; here the two diffuse paths give the same quantity — the mean radiance weighted by the cosine;
 * - `irradianceCubeMain` writes the cube of 8 texels the exhaustive way: the texel's diffuse light is the sum of the source mip's texels,
 *   each weighted by its solid angle and by its cosine with the texel's normal, over the sum of the weights; the pair of opposite
 *   faces of an axis is read as one, the half space of the normal choosing which;
 * - `halveCubeMain` writes a mip of the cube from the mip above, each texel the mean of four (the reference's mip generation).
 */
export const CAPTURE_COPY_LAYOUT = fieldLayout('CaptureCopyBlock', [
  ['flags', 'vec4u'],
  ['depth', 'vec4f'],
  ['image', 'vec4f'],
] as const)

/** The block of the compute passes: the source mip's side minus one, its inverse, the output's inverse (`sides`). */
export const CAPTURE_DIFFUSE_LAYOUT = fieldLayout('CaptureDiffuseBlock', [
  ['sides', 'vec4f'],
] as const)

const COPY_TEXT = `${CAPTURE_COPY_LAYOUT.wgsl}
@group(0) @binding(0) var scene:texture_2d<f32>;
@group(0) @binding(1) var sceneSampler:sampler;
@group(0) @binding(2) var sceneDepth:texture_depth_2d;
@group(1) @binding(0) var<uniform> copy:CaptureCopyBlock;
@fragment fn copyCaptureFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let invSide=copy.depth.z;
 let at=vec2f(1.0-pixel.x*invSide,pixel.y*invSide)*copy.image.xy;
 let seen=clamp(textureSampleLevel(scene,sceneSampler,at,0.0).rgb,vec3f(0.0),vec3f(HALF_MAX));
 var alpha=1.0;
 if(copy.flags.x!=0u){
  let z=textureLoad(sceneDepth,vec2i(at*vec2f(textureDimensions(sceneDepth))),0);
  let ndc=at/copy.image.xy*2.0-1.0;
  let radial=select(copy.depth.x/z*sqrt(1.0+dot(ndc,ndc)),3.0e38,z<=0.0);
  alpha=1.0-smoothstep(0.8*copy.depth.y,copy.depth.y,radial);
 }
 return vec4f(seen*alpha,alpha);
}`

const DIFFUSE_TEXT = `${CAPTURE_DIFFUSE_LAYOUT.wgsl}
@group(0) @binding(0) var<uniform> block:CaptureDiffuseBlock;
@group(0) @binding(1) var<uniform> irradiance:array<vec4f,${IRRADIANCE_VECTORS}>;
@group(0) @binding(2) var source:texture_2d_array<f32>;
@group(0) @binding(3) var out:texture_storage_2d_array<${SKY_LIGHT_CUBE_FORMAT},write>;
fn texelNormal(id:vec3u)->vec3f{
 let uv=(vec2f(id.xy)+0.5)*block.sides.z*2.0-1.0;
 return normalize(faceDirection(uv,id.z));
}
/** The harmonics' light along the unit d of the cube's frame: three dot products against the first band's vectors, three against the
 *  quadratic terms, one with the last, never negative. */
fn packedIrradiance(d:vec3f)->vec3f{
 let v=vec4f(d,1.0);
 let first=vec3f(dot(irradiance[0],v),dot(irradiance[1],v),dot(irradiance[2],v));
 let quadratic=v.xyzz*v.yzzx;
 let second=vec3f(dot(irradiance[3],quadratic),dot(irradiance[4],quadratic),dot(irradiance[5],quadratic));
 return max(vec3f(0.0),first+second+irradiance[6].xyz*(v.x*v.x-v.y*v.y));
}
@compute @workgroup_size(${FILTER_GROUP_SIDE},${FILTER_GROUP_SIDE},1)
fn shCubeMain(@builtin(global_invocation_id) id:vec3u){
 let side=textureDimensions(out).x;
 if(id.x>=side||id.y>=side){return;}
 textureStore(out,id.xy,id.z,vec4f(packedIrradiance(texelNormal(id)),1.0));
}
@compute @workgroup_size(${FILTER_GROUP_SIDE},${FILTER_GROUP_SIDE},1)
fn irradianceCubeMain(@builtin(global_invocation_id) id:vec3u){
 let side=textureDimensions(out).x;
 if(id.x>=side||id.y>=side){return;}
 let normal=texelNormal(id);
 let last=i32(block.sides.x);
 var sum=vec3f(0.0);
 var total=0.0;
 for(var y=0;y<=last;y++){
  for(var x=0;x<=last;x++){
   let scaled=(vec2f(f32(x),f32(y))+0.5)*block.sides.y*2.0-1.0;
   let unit=normalize(vec3f(scaled,1.0));
   let squared=1.0+dot(scaled,scaled);
   let texel=4.0/(sqrt(squared)*squared);
   var weight=dot(normal,vec3f(unit.z,-unit.y,-unit.x));
   sum+=textureLoad(source,select(vec2i(x,last-y),vec2i(x,y),weight>=0.0),select(1,0,weight>=0.0),0).rgb*(texel*abs(weight));
   total+=texel*abs(weight);
   weight=dot(normal,vec3f(unit.x,unit.z,unit.y));
   sum+=textureLoad(source,select(vec2i(last-x,y),vec2i(x,y),weight>=0.0),select(3,2,weight>=0.0),0).rgb*(texel*abs(weight));
   total+=texel*abs(weight);
   weight=dot(normal,vec3f(unit.x,-unit.y,unit.z));
   sum+=textureLoad(source,select(vec2i(x,last-y),vec2i(x,y),weight>=0.0),select(5,4,weight>=0.0),0).rgb*(texel*abs(weight));
   total+=texel*abs(weight);
  }
 }
 textureStore(out,id.xy,id.z,vec4f(sum/total,1.0));
}
@compute @workgroup_size(${FILTER_GROUP_SIDE},${FILTER_GROUP_SIDE},1)
fn halveCubeMain(@builtin(global_invocation_id) id:vec3u){
 let side=textureDimensions(out).x;
 if(id.x>=side||id.y>=side){return;}
 let at=vec2i(id.xy)*2;
 let mean=(textureLoad(source,at,id.z,0)+textureLoad(source,at+vec2i(1,0),id.z,0)+textureLoad(source,at+vec2i(0,1),id.z,0)+textureLoad(source,at+vec2i(1,1),id.z,0))*0.25;
 textureStore(out,id.xy,id.z,mean);
}`

/** The face copy (`copyCaptureFaceMain`) and the diffuse programs (`shCubeMain`, `irradianceCubeMain`, `halveCubeMain`). */
export const CAPTURE_COPY_CODE = wgslProgram(COPY_TEXT, [
  SKY_CUBE_WGSL,
  FULLSCREEN_VERTEX,
  HALF_MAX,
])
export const CAPTURE_DIFFUSE_CODE = wgslProgram(DIFFUSE_TEXT, [
  PI,
  SKY_CUBE_WGSL,
  SKY_SAMPLING_WGSL,
])
export const CAPTURE_COPY_ENTRY = 'copyCaptureFaceMain'
export const CAPTURE_DIFFUSE_ENTRIES = {
  sh: 'shCubeMain',
  reference: 'irradianceCubeMain',
  halve: 'halveCubeMain',
} as const
