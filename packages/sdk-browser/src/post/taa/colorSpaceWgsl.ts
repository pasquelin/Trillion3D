import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { interleavedGradientNoise, rand3dPcg16 } from '../../../../math/src/wgsl/sampling.ts'
import { HALF_MAX } from '../../../../math/src/constants.ts'
import { DISPLAY_FORMAT } from '../../scene/targetFormats.ts'

/**
 * The colour spaces the temporal passes measure and store in, and the noise they dither with.
 *
 * - The perceptual space: `x / (x + 0.17)` of a linear exposed colour, per channel — the render-resolution
 *   history kept for the shading analysis is stored in it, eight bits a channel, so its rounding
 *   falls along a curve close to the display's (`linearToPerceptual`, `perceptualToLinear`).
 * - The measurement space: the perceptual space squared, a curve close to the display's tone curve kept
 *   linear in the shadows, where every rejection is measured (`measureOf` a channel,
 *   `linearToMeasure` a colour), and its luma, the mean of its three channels (`measureLuma`).
 * - The perception offset `x / (x + a)` the shading history's update blends in, and its inverse:
 *   the perceptual space is its offset 0.17.
 * - The tone weight of a colour, `1 / (R + 2G + B + 4)` of the exposed colour floored at 0.0001: a
 *   bright sample weighs less, so one firefly cannot dominate a blend (`toneWeight`).
 *
 * `HALF_MAX`, the largest half float, bounds every inverse so a channel at one stays finite.
 */
const PERCEPTUAL_OFFSET = 0.17
/** The mantissa bits a channel of each target format the passes store or show keeps: eight a
 *  normalised byte, ten a half float, five the blue of an 11-11-10 float (its coarsest). */
const MANTISSA_BITS: Partial<Record<GPUTextureFormat, number>> = {
  rgba8unorm: 8,
  bgra8unorm: 8,
  rg8unorm: 8,
  rgba16float: 10,
  rg11b10ufloat: 5,
}
/** The rounding step of a channel of `format`, relative to its value for a float, absolute for a
 *  normalised one: what a stochastic rounding into it moves a channel by (`ditherUnorm`,
 *  `ditherFloat`). A format not listed stores single floats, 23 bits. */
export const quantizationError = (format: GPUTextureFormat) => 0.5 ** (MANTISSA_BITS[format] ?? 23)
/** The largest scene colour a channel holds before a sum of four of them overflows a half. */
export const LARGEST_SCENE_COLOR = HALF_MAX * 0.25
/** The largest value a 10-bit float holds (5 exponent bits, a full 5 bit mantissa): what a stored
 *  history colour is held below. */
export const LARGEST_SMALL_FLOAT = 64512
/** The largest value an 11-bit float holds (5 exponent bits, a full 6 bit mantissa). */
export const MOST_11_BIT = 65024
/** Half a step of the display the image is shown on (`DISPLAY_FORMAT`): below it no change is
 *  seen. */
export const DISPLAY_STEP_ERROR = quantizationError(DISPLAY_FORMAT) / 2
/** A luma flicker of `e` may be a channel's of `3e`: the measurement luma is the mean of three
 *  channels. */
export const LUMA_TO_CHANNEL = 3

export const COLOR_SPACES_WGSL = wgslBlock(
  'COLOR_SPACES_WGSL',
  [],
  `
fn addPerception(c:vec3f,offset:f32)->vec3f{return c/(c+offset);}
fn removePerception(c:vec3f,offset:f32)->vec3f{return c*min(vec3f(offset)/max(vec3f(1.0)-c,vec3f(1e-30)),vec3f(${wgslF32(HALF_MAX)}));}
fn linearToPerceptual(c:vec3f)->vec3f{return addPerception(c,${wgslF32(PERCEPTUAL_OFFSET)});}
fn perceptualToLinear(g:vec3f)->vec3f{return removePerception(g,${wgslF32(PERCEPTUAL_OFFSET)});}
fn measureOf(x:f32)->f32{let g=x/(x+${wgslF32(PERCEPTUAL_OFFSET)});return g*g;}
fn linearToMeasure(c:vec3f)->vec3f{return vec3f(measureOf(c.r),measureOf(c.g),measureOf(c.b));}
fn measureLuma(c:vec3f)->f32{return dot(linearToMeasure(c),vec3f(${wgslF32(1 / LUMA_TO_CHANNEL)}));}
fn luma4(c:vec3f)->f32{return c.g*2.0+c.r+c.b;}
fn toneWeightOfLuma4(l:f32)->f32{return max(0.0001,1.0/(l+4.0));}
fn toneWeight(c:vec3f)->f32{return toneWeightOfLuma4(luma4(c));}`,
)

/**
 * The noise the passes dither and decide by:
 * - `interleavedGradientNoise`, of a pixel position at frame `frame`;
 * - `frameRandom`, a 16-bit draw in [0, 1) of a pixel and the image's rank among eight, from the
 *   3D integer hash (`rand3dPcg16`);
 * - `ditherUnorm`, a unit channel rounded stochastically in its target: moved by its step times the
 *   draw less a half, so the target's rounding averages to the value (`step`, `quantizationError` of
 *   its target's format);
 * - `ditherFloat`, the same for a float target whose mantissa holds `bits` bits: the step is the
 *   value's own power of two below `value · 2^-bits`.
 */
export const DITHER_WGSL = wgslBlock(
  'DITHER_WGSL',
  [rand3dPcg16, interleavedGradientNoise],
  `
fn frameRandom(p:vec2i,slot:u32)->vec2f{return vec2f(rand3dPcg16(vec3i(p,i32(slot))).xy)*(1.0/65536.0);}
fn ditherUnorm(c:vec3f,e:f32,step:f32)->vec3f{return c+vec3f(step)*(e-0.5);}
fn ditherFloat(c:vec3f,e:f32,error:f32)->vec3f{
 let size=bitcast<vec3f>(bitcast<vec3u>(c*error)&vec3u(0xff800000u));
 return c+size*e;
}`,
)

/**
 * The flicker luma of an exposed colour: its measurement luma's square root — the perceptual
 * space — in eight bits, as the measure keeps it, the step count (`flickerLumaStep`, a whole number
 * a half float holds exactly); `flickerLumaMeasure` of that count, its square, the measurement space
 * again.
 */
export const FLICKER_LUMA_WGSL = wgslBlock(
  'FLICKER_LUMA_WGSL',
  [COLOR_SPACES_WGSL],
  `
fn flickerLumaStep(exposed:vec3f)->f32{return round(sqrt(measureLuma(exposed))*255.0);}
fn flickerLumaMeasure(lumaStep:f32)->f32{let l=lumaStep/255.0;return l*l;}`,
)
