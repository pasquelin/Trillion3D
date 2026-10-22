/**
 * WHAT THE CONVOLUTION READS OF ITS KERNEL, on the CPU, in double precision: where the kernel's
 * centre is, how much light stays there and how much is spread, and the brightest value just outside
 * the centre, which the rest of the kernel is clamped to — so the scatter is the haze around the
 * centre, never the centre's own peak. The kernel is a high dynamic range picture; the centre may be
 * a single texel a million times brighter than the haze around it.
 */
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../../../math/src/scalar/reals.ts'
import { SRGB_LUMINANCE } from '../../../../../../math/src/color/color.ts'
import type { BloomKernelImage } from '../../../../../../sdk-core/src/contracts/bloomConvolutionOptions.ts'

/** A value of the four channels. */
export type Vec4 = readonly [number, number, number, number]

/** What is read of a kernel for an image (`analyseKernel`). */
export interface KernelStats {
  /** The texel of the kernel's centre, its brightest. */
  centre: readonly [number, number]
  /** Whether the kernel holds any light at all: a kernel of zeros has no centre. */
  lit: boolean
  /** The light that stays at the centre: what the centre's footprint holds over the haze beside it. */
  centreEnergy: Vec4
  /** The light spread: every texel of the kernel, held to the haze beside the centre. */
  scatterEnergy: Vec4
  /** The brightest haze just outside the centre's footprint, per channel (red, green and blue share
   *  the brightest of the three). */
  maxScatter: Vec4
}

/** Texels along a side of a group of the reference's surveys, which the survey's reach is a whole
 *  number of. */
const TILE = 8
/** Texels of margin the survey reaches past the centre's footprint. */
const SURVEY_MARGIN = 4

/** `x` held to [0, 1], 0 for a value that is none. */
const unit = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0)

/** The texel of the kernel brightest in luminance, the first of them, none when it is all dark. */
function brightest({ width, height, pixels }: BloomKernelImage) {
  let best = 0,
    at = -1
  for (let i = 0, n = width * height; i < n; i++) {
    const luma =
      pixels[4 * i] * SRGB_LUMINANCE[0] +
      pixels[4 * i + 1] * SRGB_LUMINANCE[1] +
      pixels[4 * i + 2] * SRGB_LUMINANCE[2]
    if (luma > best) {
      best = luma
      at = i
    }
  }
  return at < 0 ? undefined : ([at % width, Math.floor(at / width)] as const)
}

/** The light of a texel's channel: 0 where it is not a number or is under 0, as the kernel's
 *  preparation holds it (`holdKernel`). */
const texel = (pixels: Float32Array, at: number, channel: number) => {
  const value = pixels[4 * at + channel]
  return value > 0 && Number.isFinite(value) ? value : 0
}

/**
 * The survey of the texels around the centre, `reach` texels out each side but the last on each
 * axis: `visit(at, m)` for each, `at` the texel's index — wrapped around the kernel's edges as an
 * unsigned word wraps — and `m` the larger of its two offsets from the centre in absolute value.
 */
function survey(
  { width, height }: BloomKernelImage,
  centre: readonly [number, number],
  reach: number,
  visit: (at: number, m: number) => void,
) {
  for (let oy = -reach; oy < reach; oy++)
    for (let ox = -reach; ox < reach; ox++) {
      const x = ((centre[0] + ox) >>> 0) % width,
        y = ((centre[1] + oy) >>> 0) % height
      visit(y * width + x, Math.max(Math.abs(ox), Math.abs(oy)))
    }
}

/** The brightest haze around the centre's footprint of radius `radius` (`analyseKernel`): the
 *  brightest of red, green and blue shared by the three, the alpha's own, each as a float32 holds
 *  it, the way the uniform that carries it will. */
function haze(
  kernel: BloomKernelImage,
  centre: readonly [number, number],
  reach: number,
  radius: number,
) {
  const { pixels } = kernel
  let colour = 0,
    alpha = 0
  survey(kernel, centre, reach, (at, m) => {
    const zone = unit(1 - unit(2 * radius + 1 - m)) * unit(2 * radius + 4 - m)
    colour = Math.max(colour, texel(pixels, at, 0) * zone, texel(pixels, at, 1) * zone)
    colour = Math.max(colour, texel(pixels, at, 2) * zone)
    alpha = Math.max(alpha, texel(pixels, at, 3) * zone)
  })
  const [rgb, a] = [Math.fround(colour), Math.fround(alpha)]
  return [rgb, rgb, rgb, a] as unknown as Vec4
}

/** The light the footprint holds over the haze (`analyseKernel`). */
function footprint(
  kernel: BloomKernelImage,
  centre: readonly [number, number],
  reach: number,
  radius: number,
  haze: Vec4,
) {
  const sum = [0, 0, 0, 0]
  survey(kernel, centre, reach, (at, m) => {
    const zone = unit(radius + 0.5 - m)
    for (let c = 0; c < 4; c++) sum[c] += Math.max(texel(kernel.pixels, at, c) - haze[c], 0) * zone
  })
  return sum as unknown as Vec4
}

/** The light of the whole kernel held to the haze. */
function spread({ pixels, width, height }: BloomKernelImage, haze: Vec4) {
  const sum = [0, 0, 0, 0]
  for (let at = 0, n = width * height; at < n; at++)
    for (let c = 0; c < 4; c++) sum[c] += clamp(texel(pixels, at, c), 0, haze[c])
  return sum as unknown as Vec4
}

const NONE: Vec4 = [0, 0, 0, 0]

/**
 * What the convolution reads of `kernel` for an image `imageWidth` texels wide that the kernel is
 * `support` of the width of: the footprint of a texel of the image in the kernel's, `radius` texels
 * out from the centre, is where the centre's light is counted; just beyond it is the haze whose
 * brightest value the rest is held to.
 */
export function analyseKernel(
  kernel: BloomKernelImage,
  imageWidth: number,
  support: number,
): KernelStats {
  const centre = brightest(kernel)
  if (!centre)
    return { centre: [0, 0], lit: false, centreEnergy: NONE, scatterEnergy: NONE, maxScatter: NONE }
  const across = Math.max(Math.fround(imageWidth * support), 1)
  const radius = Math.fround(Math.max(Math.fround(kernel.width / across), 1) * 0.5)
  const reach = TILE * ceilDiv(Math.ceil(radius) + SURVEY_MARGIN, TILE)
  const maxScatter = haze(kernel, centre, reach, radius)
  return {
    centre,
    lit: true,
    centreEnergy: footprint(kernel, centre, reach, radius, maxScatter),
    scatterEnergy: spread(kernel, maxScatter),
    maxScatter,
  }
}

/** What the transform's constants are made of per image (`applyConstants`). */
export interface ApplyConstants {
  /** What the image keeps: its colour is multiplied by this, so the light the glow takes is gone from
   *  where it came from. */
  sceneTint: Vec4
  /** What the glow is multiplied by. */
  multiply: Vec4
}

/**
 * The shares of the light that stay and that spread, with the strength `scatterIntensity` asks of
 * the spread: the kernel's tint — its colour over its brightest channel, so the glow takes the
 * kernel's colour at full strength in its strongest channel —, the share of its total energy each
 * part holds, and the light left at the centre once the spread is taken.
 */
export function applyConstants(stats: KernelStats, scatterIntensity: number): ApplyConstants {
  const total = stats.centreEnergy.map((c, i) => c + stats.scatterEnergy[i])
  const brightestChannel = Math.max(total[0], total[1], total[2])
  const tint = [0, 1, 2].map((c) => unit(total[c] / brightestChannel)).concat(1)
  const scatter = stats.scatterEnergy.map((s) => s * scatterIntensity)
  const share = (part: number[]) => part.map((p, c) => tint[c] * unit(p / total[c]))
  const centre = total.map((t, c) => t - scatter[c])
  return {
    sceneTint: share(centre) as unknown as Vec4,
    multiply: share(scatter) as unknown as Vec4,
  }
}
