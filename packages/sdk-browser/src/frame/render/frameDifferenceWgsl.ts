import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'

/** How many times the frame-difference view amplifies a change: a step of one 8-bit level in the
 *  display shows as eight. */
const FRAME_DIFFERENCE_GAIN = 8

/** The display image against the one before, pixel for pixel: the luminance of their difference,
 *  in display values — what the eye sees change —, amplified (`FRAME_DIFFERENCE_GAIN`) and shown as
 *  grey. A still pixel is black to the bit. */
export const FRAME_DIFFERENCE_WGSL = wgslProgram(
  `
@group(0) @binding(0) var current:texture_2d<f32>;
@group(0) @binding(1) var previous:texture_2d<f32>;
@fragment fn difference(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);
 let step=textureLoad(current,coord,0).rgb-textureLoad(previous,coord,0).rgb;
 return vec4f(vec3f(saturate(abs(luminance(step))*${FRAME_DIFFERENCE_GAIN}.0)),1.0);
}`,
  [FULLSCREEN_VERTEX, luminance],
)
