import { FULLSCREEN_XY_WGSL } from '../shader/fullscreenTriangle.ts'
import { FULLSCREEN_VERTEX } from '../../lighting/deferred/deferred.ts'

/** The image copied to the whole canvas (`presentation.ts`). */
export const PRESENT_SHADER = `@group(0) @binding(0) var image:texture_2d<f32>;
${FULLSCREEN_VERTEX}
@fragment fn present(@builtin(position) pixel:vec4f)->@location(0) vec4f{return textureLoad(image,vec2i(pixel.xy),0);}`
/** The image copied at a rectangle of the canvas (`presentAt.ts`): its origin rides in the draw's
 *  first instance, `x + y · 65536`, so no uniform is written and no buffer is held per view. */
export const PRESENT_AT_SHADER = `@group(0) @binding(0) var image:texture_2d<f32>;
struct Placed{@builtin(position) position:vec4f,@location(0) @interpolate(flat) origin:vec2i};
@vertex fn fullscreenAt(@builtin(vertex_index) i:u32,@builtin(instance_index) at:u32)->Placed{
return Placed(vec4f(${FULLSCREEN_XY_WGSL},0.0,1.0),vec2i(i32(at&0xffffu),i32(at>>16u)));}
@fragment fn presentAt(placed:Placed)->@location(0) vec4f{
return textureLoad(image,vec2i(placed.position.xy)-placed.origin,0);}`
