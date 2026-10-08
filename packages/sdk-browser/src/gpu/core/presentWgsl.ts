import { FULLSCREEN_XY } from '../shader/fullscreenTriangle.ts'
import { FULLSCREEN_VERTEX } from '../../lighting/deferred/deferred.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { highHalf, lowHalf } from '../../../../math/src/wgsl/integer.ts'

/** The image copied to the whole canvas (`presentation.ts`). */
export const PRESENT_SHADER = wgslProgram(
  `@group(0) @binding(0) var image:texture_2d<f32>;
@fragment fn present(@builtin(position) pixel:vec4f)->@location(0) vec4f{return textureLoad(image,vec2i(pixel.xy),0);}`,
  [FULLSCREEN_VERTEX],
)
/** The image copied at a rectangle of the canvas (`presentAt.ts`): its origin rides in the draw's
 *  first instance, `x + y · 65536`, so no uniform is written and no buffer is held per view. */
export const PRESENT_AT_SHADER = wgslProgram(
  `@group(0) @binding(0) var image:texture_2d<f32>;
struct Placed{@builtin(position) position:vec4f,@location(0) @interpolate(flat) origin:vec2i};
@vertex fn fullscreenAt(@builtin(vertex_index) i:u32,@builtin(instance_index) at:u32)->Placed{
return Placed(vec4f(${FULLSCREEN_XY},0.0,1.0),vec2i(i32(lowHalf(at)),i32(highHalf(at))));}
@fragment fn presentAt(placed:Placed)->@location(0) vec4f{
return textureLoad(image,vec2i(placed.position.xy)-placed.origin,0);}`,
  [lowHalf, highHalf],
)
