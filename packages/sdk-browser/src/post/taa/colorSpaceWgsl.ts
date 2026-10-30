import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { interleavedGradientNoise, rand3dPcg16 } from '../../../../math/src/wgsl/sampling.ts'
import { HALF_MAX } from '../../../../math/src/constants.ts'
import { packSmallFloatDown, unpackLight, unpackSmallFloat } from '../../gpu/core/smallFloatWgsl.ts'

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
 *   the perceptual space is its offset 0.17. `exposedShadingBy` brings a colour of that space to
 *   another exposure, `ratio` times the light.
 * - The tone weight of a colour, `1 / (R + 2G + B + 4)` of the exposed colour floored at 0.0001: a
 *   bright sample weighs less, so one firefly cannot dominate a blend (`toneWeight`).
 *
 * `HALF_MAX`, the largest half float, bounds every inverse so a channel at one stays finite.
 */
const PERCEPTUAL_OFFSET = 0.17
/** The mantissa bits each colour channel of the target formats the passes store or show keeps:
 *  eight a normalised byte, ten a ten-bit normalised channel or a half float, six, six and five an
 *  11-11-10 float. A format not listed stores single floats, 23 bits. */
const MANTISSA_BITS: Partial<Record<GPUTextureFormat, readonly [number, number, number]>> = {
  rgba8unorm: [8, 8, 8],
  bgra8unorm: [8, 8, 8],
  rg8unorm: [8, 8, 8],
  rgb10a2unorm: [10, 10, 10],
  rgba16float: [10, 10, 10],
  rg11b10ufloat: [6, 6, 5],
}
const mantissaBitsOf = (format: GPUTextureFormat) => MANTISSA_BITS[format] ?? [23, 23, 23]
/** The rounding step of the coarsest channel of `format`, relative to its value for a float,
 *  absolute for a normalised one: what a stochastic rounding into it moves a channel by
 *  (`ditherUnorm`, `ditherFloat`). */
export const quantizationError = (format: GPUTextureFormat) =>
  0.5 ** Math.min(...mantissaBitsOf(format))
/** The same, channel by channel, as a WGSL `vec3f`. */
export const quantizationErrorsOf = (format: GPUTextureFormat) =>
  `vec3f(${mantissaBitsOf(format)
    .map((bits) => wgslF32(0.5 ** bits))
    .join(',')})`

/** The words a pixel of the scene colour the shading rejection hands the history update takes in
 *  its buffer (`sceneColorWgsl`): four half floats in two, whatever the history's colour format.
 *  DEVIATION, declared: the reference writes this colour as 11-11-10 floats, 4 bytes; ours holds four
 *  half floats in 8 bytes, a deliberate departure for speed: the hardware unpacks them where the
 *  11-11-10 word is decoded in software at every tap of the history update, measured about 25% faster
 *  on that pass. The values are the same, since every 11-11-10 value is exact in a half. */
export const SCENE_COLOR_WORDS = 2

/**
 * THE SCENE COLOUR IN A BUFFER, rounded to the history's colour format (`HistoryFormats.color`) as a
 * texture of that format would hold it: the shading rejection writes it, the history update reads
 * it (`sceneColorAt`), so a storage buffer stands in for a texture the stage could not bind.
 * - `packSmallFloatDown` (`smallFloatWgsl.ts`): a float in a float of five exponent bits (bias 15) and `mantissa` bits,
 *   rounded toward zero — the rounding the stochastic rounding before it is made for —, none below
 *   zero, NaN as zero, the largest finite past it; `unpackSmallFloat` (the same file) its exact value. Built of the
 *   float's bits alone: every power of two by its exponent, never `exp2`.
 * - Held as four half floats (sign, five exponent bits, ten of mantissa) in two words, red and green
 *   in the first, which the hardware reads back in two conversions where the 11-11-10 word took a
 *   software decoding of each channel at every one of the history update's kernel taps. Every
 *   11-11-10 value (six or five bits of mantissa over the same exponent range) is exact in a half,
 *   so the update reads the value the format holds: a colour is rounded toward zero to the format's
 *   fields first (red and green six bits, blue five) and widened, its alpha one, as the format has
 *   none; for half floats the colour is rounded toward zero to the half itself.
 */
export const sceneColorWgsl = (format: GPUTextureFormat) =>
  wgslBlock(
    `sceneColorWgsl(${format})`,
    [packSmallFloatDown, unpackSmallFloat, unpackLight],
    `
fn packHalf(f:f32)->u32{return packSmallFloatDown(abs(f),10u)|select(0u,0x8000u,f<0.0);}
fn packSceneColor(c:vec4f)->array<u32,${SCENE_COLOR_WORDS}>{${
      format === 'rg11b10ufloat'
        ? `
 let held=unpackLight(packSmallFloatDown(c.r,6u)|(packSmallFloatDown(c.g,6u)<<11u)|(packSmallFloatDown(c.b,5u)<<22u));
 return array<u32,2>(pack2x16float(held.rg),pack2x16float(vec2f(held.b,1.0)));`
        : `
 return array<u32,2>(packHalf(c.r)|(packHalf(c.g)<<16u),packHalf(c.b)|(packHalf(c.a)<<16u));`
    }
}
fn unpackSceneColor(w:array<u32,${SCENE_COLOR_WORDS}>)->vec4f{
 return vec4f(unpack2x16float(w[0]),unpack2x16float(w[1]));
}`,
  )
/** The largest scene colour a channel holds before a sum of four of them overflows a half. */
export const LARGEST_SCENE_COLOR = HALF_MAX * 0.25
/** The largest value an 11-bit float holds (5 exponent bits, a full 6 bit mantissa). */
export const MOST_11_BIT = 65024
/** Half a step of a display of ten bits a channel, the finest the image may be shown on: below it
 *  no change is seen. */
export const DISPLAY_STEP_ERROR = 0.5 / 1024
/** A luma flicker of `e` may be a channel's of `3e`: the measurement luma is the mean of three
 *  channels. */
export const LUMA_TO_CHANNEL = 3

/**
 * The precision a temporal program computes its colours and weights in: 32-bit floats, or 16-bit
 * ones where the device grants `shader-f16` (§ 25.11 of the WebGPU specification) and the
 * execution asks it (`TaaExecution.half`). `F`, `V2`, `V3`, `V4` the scalar and vector types; `S` the
 * suffix of the helpers' names written for it — none for 32 bits, so a 16-bit program may hold both
 * sets; `enable` the directive it needs. One text makes both (`colorSpacesWgsl`, `ditherWgsl`, …);
 * the 16-bit set adds `safeRcpH`, the 32-bit `safeRcp` being the maths library's.
 */
export interface Precision {
  readonly F: string
  readonly V2: string
  readonly V3: string
  readonly V4: string
  readonly S: string
  /** The least positive value the precision divides by in place of zero. */
  readonly tiny: number
  readonly enable: readonly WgslDecl[]
}
/** The directive of a program that computes in 16 bits: the language's `f16`. */
const F16_WGSL = wgslBlock('F16_WGSL', [], 'enable f16;')
export const FULL_PRECISION: Precision = {
  F: 'f32',
  V2: 'vec2f',
  V3: 'vec3f',
  V4: 'vec4f',
  S: '',
  tiny: 1e-30,
  enable: [],
}
export const HALF_PRECISION: Precision = {
  F: 'f16',
  V2: 'vec2h',
  V3: 'vec3h',
  V4: 'vec4h',
  S: 'H',
  tiny: 2 ** -24,
  enable: [F16_WGSL],
}

const colorSpacesText = ({ F, V3, S, tiny }: Precision) => `
fn addPerception${S}(c:${V3},offset:${F})->${V3}{return c/(c+offset);}
fn removePerception${S}(c:${V3},offset:${F})->${V3}{return c*min(${V3}(offset)/max(${V3}(1.0)-c,${V3}(${wgslF32(tiny)})),${V3}(${wgslF32(HALF_MAX)}));}
fn linearToPerceptual${S}(c:${V3})->${V3}{return addPerception${S}(c,${wgslF32(PERCEPTUAL_OFFSET)});}
fn perceptualToLinear${S}(g:${V3})->${V3}{return removePerception${S}(g,${wgslF32(PERCEPTUAL_OFFSET)});}
fn exposedShadingBy${S}(g:${V3},ratio:${F})->${V3}{return max(linearToPerceptual${S}(perceptualToLinear${S}(g)*ratio),${V3}(0.0));}
fn measureOf${S}(x:${F})->${F}{let g=x/(x+${wgslF32(PERCEPTUAL_OFFSET)});return g*g;}
fn linearToMeasure${S}(c:${V3})->${V3}{return ${V3}(measureOf${S}(c.r),measureOf${S}(c.g),measureOf${S}(c.b));}
fn measureLuma${S}(c:${V3})->${F}{return dot(linearToMeasure${S}(c),${V3}(${wgslF32(1 / LUMA_TO_CHANNEL)}));}
fn luma4${S}(c:${V3})->${F}{return c.g*2.0+c.r+c.b;}
fn toneWeightOfLuma4${S}(l:${F})->${F}{return max(0.0001,1.0/(l+4.0));}
fn toneWeight${S}(c:${V3})->${F}{return toneWeightOfLuma4${S}(luma4${S}(c));}${
  S ? `\nfn safeRcpH(x:${F})->${F}{return select(0.0,1.0/x,x>0.0);}` : ''
}`

export const COLOR_SPACES_WGSL = wgslBlock('COLOR_SPACES_WGSL', [], colorSpacesText(FULL_PRECISION))
const COLOR_SPACES_HALF_WGSL = wgslBlock(
  'COLOR_SPACES_HALF_WGSL',
  [F16_WGSL],
  colorSpacesText(HALF_PRECISION),
)
/** The colour spaces' helpers in precision `p`, their names suffixed by `p.S`. */
export const colorSpacesWgsl = (p: Precision) =>
  p === HALF_PRECISION ? COLOR_SPACES_HALF_WGSL : COLOR_SPACES_WGSL

/**
 * The noise the passes dither and decide by:
 * - `interleavedGradientNoise`, of a pixel position at frame `frame`;
 * - `frameRandom`, a 16-bit draw in [0, 1) of a pixel and the image's rank among eight, from the
 *   3D integer hash (`rand3dPcg16`);
 * - `ditherUnorm`, a unit channel rounded stochastically in its target: moved by its step times the
 *   draw less a half, so the target's rounding averages to the value (`step`, `quantizationError` of
 *   its target's format);
 * - `ditherFloat`, the same for a float target that rounds toward zero, `error` the `2^-bits` of each
 *   channel's mantissa (`quantizationErrorsOf`): the step is the value's own power of two below
 *   `value · 2^-bits`, added times the draw.
 */
export const DITHER_WGSL = wgslBlock(
  'DITHER_WGSL',
  [rand3dPcg16, interleavedGradientNoise],
  `
fn frameRandom(p:vec2i,slot:u32)->vec2f{return vec2f(rand3dPcg16(vec3i(p,i32(slot))).xy)*(1.0/65536.0);}
fn ditherUnorm(c:vec3f,e:f32,step:f32)->vec3f{return c+vec3f(step)*(e-0.5);}
fn ditherFloat(c:vec3f,e:f32,error:vec3f)->vec3f{
 let size=bitcast<vec3f>(bitcast<vec3u>(c*error)&vec3u(0xff800000u));
 return c+size*e;
}`,
)
/** The same two in 16 bits (`ditherUnormH`, `ditherFloatH`): a half's power of two below it keeps its
 *  sign and exponent, its ten mantissa bits cleared, read through the word two halves make. */
const DITHER_HALF_WGSL = wgslBlock(
  'DITHER_HALF_WGSL',
  [F16_WGSL, DITHER_WGSL],
  `
fn ditherUnormH(c:vec3h,e:f16,step:f16)->vec3h{return c+vec3h(step)*(e-0.5);}
fn halfExponentOf(x:vec3h)->vec3h{
 let rg=unpack2x16float(pack2x16float(vec2f(x.rg))&0xfc00fc00u);
 let b=unpack2x16float(pack2x16float(vec2f(f32(x.b),0.0))&0xfc00u);
 return vec3h(vec2h(rg),f16(b.x));
}
fn ditherFloatH(c:vec3h,e:f16,error:vec3h)->vec3h{return c+halfExponentOf(c*error)*e;}`,
)
/** The dither helpers in precision `p`, their names suffixed by `p.S`; `frameRandom` stays 32-bit. */
export const ditherWgsl = (p: Precision) => (p === HALF_PRECISION ? DITHER_HALF_WGSL : DITHER_WGSL)
