import type { BloomField } from '../contracts/bloomRules.ts'

/** What each setting of how the bloom is drawn means (`../contracts/bloomRules.ts`); the glow's
 *  method, intensity, levels, convolution and dirt mask are the effect chain's (`effect.bloom`). */
export const BLOOM_MEANINGS: Readonly<Record<BloomField, string>> = {
  bloomQuality:
    "The quality of the bloom, which fixes how many of the six Gaussian levels draw, the widest first: off draws no bloom of either method, lowest and low the three widest, medium four, high five, highest all six, the default. The quality levels write high at 'smooth' and 'balanced'.",
  bloomCross:
    'A bright centre given to the Gaussian blur, from 0 (the plain blur, the default) to 1 and over (each pass keeps its centre texel and blurs nothing): above 0 both passes, a cross of light with arms along both axes; below 0 only the vertical pass, by the absolute value, a streak along the horizontal.',
  bloomScreenPercentage:
    "The resolution the convolution bloom runs at, in percent of the image's width, from 10 to 100, 100 by default: lower is much cheaper and softer. The quality levels write 25 at 'smooth', 35.355 at 'balanced' and 50 at 'fine'.",
  bloomApplyLocalExposure:
    'Whether the local exposure is applied to the image the bloom reads, so that what glows is what the image will show; on by default.',
  bloomCacheKernel:
    "Whether the convolution bloom keeps the transform of its kernel while the kernel, its size and the image's size hold, on by default; off, it is made again at every image.",
}
