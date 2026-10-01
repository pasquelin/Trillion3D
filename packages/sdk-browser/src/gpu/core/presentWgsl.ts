import { FULLSCREEN_VERTEX } from '../../lighting/deferred/deferred.ts';

/** The image copied to the whole canvas (`presentation.ts`). */
export const PRESENT_SHADER = `@group(0) @binding(0) var image:texture_2d<f32>;
${FULLSCREEN_VERTEX}
@fragment fn present(@builtin(position) pixel:vec4f)->@location(0) vec4f{return textureLoad(image,vec2i(pixel.xy),0);}`;
/** The image copied at a rectangle of the canvas (`presentAt.ts`): its origin rides in the draw's
 *  first instance, `x + y · 65536`, so no uniform is written and no buffer is held per view. */
const PRESENT_AT_SHADER = `@group(0) @binding(0) var image:texture_2d<f32>;
struct Placed{@builtin(position) position:vec4f,@location(0) @interpolate(flat) origin:vec2i};
@vertex fn fullscreenAt(@builtin(vertex_index) i:u32,@builtin(instance_index) at:u32)->Placed{
return Placed(vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0),vec2i(i32(at&0xffffu),i32(at>>16u)));}
@fragment fn presentAt(placed:Placed)->@location(0) vec4f{
return textureLoad(image,vec2i(placed.position.xy)-placed.origin,0);}`;

/** Display-encoded source values must be linear before an sRGB attachment encodes them. */
export function presentAtShader(format: GPUTextureFormat) {
  if (!format.endsWith('-srgb')) return PRESENT_AT_SHADER;
  return `${PRESENT_DECODE_WGSL}
${PRESENT_AT_SHADER.replace(
  'return textureLoad(image,vec2i(placed.position.xy)-placed.origin,0);',
  'let color=textureLoad(image,vec2i(placed.position.xy)-placed.origin,0);return vec4f(presentDecode(color.x),presentDecode(color.y),presentDecode(color.z),color.w);',
)}`;
}
const PRESENT_DECODE_WGSL = `fn presentDecode(c:f32)->f32{
if(c<=0.04045){return c/12.92;}return pow((c+0.055)/1.055,2.4);}`;
