import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/** The bindings the denoiser's passes add to the group of the screen-space traces (`SCREEN_SPACE_BINDINGS`; the passes write `out` and `outSecond` of that table):
 *  the parameters, the signal read (two textures), the history (two), the metadata of the image before (depth and normal with the roughness), and the
 *  metadata the keeping pass writes. */
export const DENOISE_BINDINGS = {
  params: 18,
  sourceA: 19,
  sourceB: 20,
  historyA: 21,
  historyB: 22,
  prevDepth: 23,
  prevNormals: 24,
  keepDepth: 25,
  keepNormals: 26,
} as const

/**
 * THE PARAMETERS OF A DENOISING PASS (`DenoiseParams`):
 *  - `grid`: the signal's extent in texels `xy`, the full-resolution pixels a texel stands for `z` (1 or 2: texel `t` stands for pixel `t · z`), whether
 *    the history is dropped (a camera cut, a first image, a gap in the images) `w`;
 *  - `spread`: the most samples the pass reads `x`, the samples the passes before it widened the kernel with `y` (1 for the reconstruction, the
 *    most samples to the power of the pass's rank plus one for the pre-convolutions), the spread of the kernel `z`;
 *  - `time`: the frame index modulo 8 `x`, the exposure the signal's brightness is weighted with `y` (its pre-exposure).
 */
const LAYOUT = fieldLayout('DenoiseParams', [
  ['grid', 'vec4f'],
  ['spread', 'vec4f'],
  ['time', 'vec4f'],
] as const)

export const DENOISE_PARAMS_BYTES = LAYOUT.words * 4
export const DENOISE_PARAMS_WORDS = LAYOUT.words
export const DENOISE_PARAMS_WGSL = wgslBlock('DENOISE_PARAMS_WGSL', [], LAYOUT.wgsl)

/** What a pass writes of its parameters. */
export interface DenoiseParamsFields {
  width: number
  height: number
  ratio: number
  cut: boolean
  maxSamples: number
  previousCumulative: number
  spread: number
  frame: number
  exposure: number
}

/** Writes `fields` into `words` (`DENOISE_PARAMS_WORDS` words). */
export function writeDenoiseParams(words: Float32Array, fields: DenoiseParamsFields) {
  const at = LAYOUT.at
  words.set([fields.width, fields.height, fields.ratio, fields.cut ? 1 : 0], at.grid)
  words.set([fields.maxSamples, fields.previousCumulative, fields.spread, 0], at.spread)
  words.set([fields.frame, fields.exposure, 0, 0], at.time)
}
