import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_XY } from '../../../gpu/shader/fullscreenTriangle.ts'
import { HALF_FLOAT_MAX } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { FILTER_GROUP_SIDE } from './layout.ts'
import { SKY_CUBE_WGSL } from './cubeWgsl.ts'

/**
 * THE PROGRAMS OF A SPECIFIED CUBEMAP, which take the host's cube to the captured cube the mips,
 * the filter and the harmonics are made from:
 * - `copyFaceMain` writes a face of the captured cube from the host's cube: the texel's direction
 *   turned about the up axis by the block's angle, the host's cube read there bilinearly at its
 *   top level, the colour below the horizon (the turned direction's third axis negative) mixed to
 *   the lower hemisphere's colour by its coverage when the block says so, the alpha 1, all
 *   multiplied by the block's scale, and held between 0 and the half float's largest value (alpha
 *   to 1) when the block says so — a 16-bit target;
 * - `maxDownsampleMain` fills a mip of the 32-bit float cube from the one above it: the largest of
 *   the four texels around the point, each channel apart;
 * - `maxGatherMain` writes the largest channel of the last mip's six texels, the cube's brightest
 *   value.
 * - `copySceneFaceMain` writes a face of the captured cube from the lit image of the scene drawn
 *   for it (`captureScene.ts`): the image read bilinearly over the square the face fills of it
 *   (`scale.xy`, the share of the target the image takes), turned about its vertical axis — a
 *   cube's faces are laid as seen from outside, a camera sees them from inside —, held between 0 and the half float's
 *   largest value, the colour below the horizon of the face's direction mixed to the lower
 *   hemisphere's as above, the alpha 1.
 * The brightest value of a 32-bit float cube decides how it is rescaled to fit the 16-bit cube
 * (`skyLightCubemapScales`).
 */
export const COPY_LAYOUT = fieldLayout('SkyCopyBlock', [
  ['face', 'vec4u'],
  ['rotation', 'vec4f'],
  ['lower', 'vec4f'],
  ['scale', 'vec4f'],
] as const)

/** The lanes of `face`: the face's number, whether the lower hemisphere is replaced, whether the
 *  result is held to the half float's range. `rotation`: the angle's sine and cosine, and the
 *  inverse of the cube's side. */
export const COPY_CODE = wgslProgram(
  `${COPY_LAYOUT.wgsl}
@group(0) @binding(0) var source:texture_cube<f32>;
@group(0) @binding(1) var sourceSampler:sampler;
@group(0) @binding(2) var scene:texture_2d<f32>;
@group(0) @binding(3) var sceneSampler:sampler;
@group(1) @binding(0) var<uniform> copy:SkyCopyBlock;
/** The colour below the horizon (the direction's third axis negative) mixed to the lower
 *  hemisphere's by its coverage, when the block says so. */
fn lowerHemisphere(rgb:vec3f,d:vec3f)->vec3f{
 if(d.z<0.0&&copy.face.y!=0u){return mix(rgb,copy.lower.rgb,copy.lower.a);}
 return rgb;
}
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}
@fragment fn copyFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let uv=pixel.xy*copy.rotation.z*2.0-1.0;
 let face=faceDirection(uv,copy.face.x);
 let s=copy.rotation.x;
 let c=copy.rotation.y;
 let d=vec3f(face.x*c-face.y*s,face.x*s+face.y*c,face.z);
 let rgb=lowerHemisphere(textureSampleLevel(source,sourceSampler,d,0.0).rgb,d);
 var out=vec4f(rgb,1.0)*copy.scale;
 if(copy.face.z!=0u){out=clamp(out,vec4f(0.0),vec4f(${HALF_FLOAT_MAX}.0,${HALF_FLOAT_MAX}.0,${HALF_FLOAT_MAX}.0,1.0));}
 return out;
}
@fragment fn copySceneFaceMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let d=faceDirection(pixel.xy*copy.rotation.z*2.0-1.0,copy.face.x);
 let at=vec2f(1.0-pixel.x*copy.rotation.z,pixel.y*copy.rotation.z)*copy.scale.xy;
 let seen=textureSampleLevel(scene,sceneSampler,at,0.0).rgb;
 let top=vec3f(${HALF_FLOAT_MAX}.0);
 return vec4f(lowerHemisphere(clamp(seen,vec3f(0.0),top),d),1.0);
}`,
  [SKY_CUBE_WGSL],
)
export const COPY_ENTRY = 'copyFaceMain'
export const COPY_SCENE_ENTRY = 'copySceneFaceMain'

const MEASURE_FORMAT = 'rgba32float'

/** The two programs of the brightest value, over the 32-bit float cube. */
export const LUMINANCE_CODE = wgslProgram(
  `struct MaxBlock{mip:u32,mips:u32,spare:vec2u,}
@group(0) @binding(0) var<uniform> block:MaxBlock;
@group(0) @binding(1) var source:texture_cube<f32>;
@group(0) @binding(2) var nearest:sampler;
@group(0) @binding(3) var output:texture_storage_2d_array<${MEASURE_FORMAT},write>;
@group(0) @binding(4) var<storage,read_write> peak:array<f32,1>;
/** The two axes across a face's texels, in the cube's frame. */
fn faceAxes(face:u32)->array<vec3f,2>{
 switch face{
  case 0u:{return array<vec3f,2>(vec3f(0.0,-1.0,0.0),vec3f(0.0,0.0,-1.0));}
  case 1u:{return array<vec3f,2>(vec3f(0.0,-1.0,0.0),vec3f(0.0,0.0,1.0));}
  case 2u:{return array<vec3f,2>(vec3f(1.0,0.0,0.0),vec3f(0.0,0.0,1.0));}
  case 3u:{return array<vec3f,2>(vec3f(1.0,0.0,0.0),vec3f(0.0,0.0,-1.0));}
  case 4u:{return array<vec3f,2>(vec3f(1.0,0.0,0.0),vec3f(0.0,-1.0,0.0));}
  default:{return array<vec3f,2>(vec3f(-1.0,0.0,0.0),vec3f(0.0,-1.0,0.0));}
 }
}
@compute @workgroup_size(${FILTER_GROUP_SIDE},${FILTER_GROUP_SIDE},1)
fn maxDownsampleMain(@builtin(global_invocation_id) id:vec3u){
 let side=textureDimensions(output).x;
 if(id.x>=side||id.y>=side){return;}
 let face=id.z;
 let uv=(vec2f(id.xy)+0.5)/f32(side)*2.0-1.0;
 let d=faceDirection(uv,face);
 let axes=faceAxes(face);
 let offset=1.0/f32(side);
 let corners=array<vec2f,4>(vec2f(-0.5,-0.5),vec2f(0.5,-0.5),vec2f(0.5,0.5),vec2f(-0.5,0.5));
 var result=vec4f(0.0);
 for(var i=0u;i<4u;i++){
  let at=d+axes[0]*(corners[i].x*offset)+axes[1]*(corners[i].y*offset);
  result=max(result,textureSampleLevel(source,nearest,at,0.0));
 }
 textureStore(output,id.xy,face,result);
}
@compute @workgroup_size(1)
fn maxGatherMain(){
 let level=f32(block.mip);
 var m=textureSampleLevel(source,nearest,vec3f(1.0,0.0,0.0),level).rgb;
 m=max(m,textureSampleLevel(source,nearest,vec3f(-1.0,0.0,0.0),level).rgb);
 m=max(m,textureSampleLevel(source,nearest,vec3f(0.0,1.0,0.0),level).rgb);
 m=max(m,textureSampleLevel(source,nearest,vec3f(0.0,-1.0,0.0),level).rgb);
 m=max(m,textureSampleLevel(source,nearest,vec3f(0.0,0.0,1.0),level).rgb);
 m=max(m,textureSampleLevel(source,nearest,vec3f(0.0,0.0,-1.0),level).rgb);
 peak[0]=max(m.r,max(m.g,m.b));
}`,
  [SKY_CUBE_WGSL],
)
export const LUMINANCE_ENTRIES = {
  downsample: 'maxDownsampleMain',
  gather: 'maxGatherMain',
} as const
export const LUMINANCE_FORMAT: GPUTextureFormat = MEASURE_FORMAT
