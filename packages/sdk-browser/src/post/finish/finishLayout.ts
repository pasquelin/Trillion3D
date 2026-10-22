import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'

/** Cells deep of the local exposure's grid: the log luminance's 32 bands. */
export const GRID_DEPTH = 32
/** Half-size pixels one tile of the grid covers on a side. */
export const GRID_TILE = 64
/** The level of the scene's chain whose luminance is blurred: the fifth, 1/32 of the image. */
export const BLURRED_LEVEL = 4
/** The weight under which a cell of the grid, stored over `GRID_TILE²`'s 64th, holds no pixel the
 *  grid can be trusted on: a thousandth of a pixel. */
export const GRID_EMPTY = 0.001 / 64

/**
 * The display finishing's uniform (`finishWgsl.ts`), one `vec4f` each:
 * - `look`: the vignette's strength, the exposure — copied on the GPU from the view's, which an
 *   automatic exposure writes —, 1 where the local exposure runs, 1 where a glow is added;
 * - `screen`: the vignette's scale on each axis, which makes its falloff a circle on any aspect;
 * - `weights`: the weights of a pixel's colour channels in its luminance, the lowest luminance;
 * - `histogram`: the scale and bias taking a log2 luminance over the grid's depth, the share of
 *   the blurred luminance in the base layer, the weight under which a grid cell is empty;
 * - `base`: log2 of the middle grey the base layer is pulled toward, the highlights' and the
 *   shadows' contrast scale, the detail's strength;
 * - `grid`: the grid's coordinates per image coordinate, the highlight and shadow thresholds;
 * - `reach`: how far past each threshold the contrast scale takes over, highlights then shadows.
 */
export const FINISH = fieldLayout('Finish', [
  ['look', 'vec4f'],
  ['screen', 'vec4f'],
  ['weights', 'vec4f'],
  ['histogram', 'vec4f'],
  ['base', 'vec4f'],
  ['grid', 'vec4f'],
  ['reach', 'vec4f'],
] as const)
/** Bytes of the finishing's uniform. */
export const FINISH_BYTES = FINISH.words * 4

/**
 * The group the finishing reads, 1 of the programs that read it: the uniform, the local
 * exposure's grid and its blurred log luminance, a bilinear sampler and the bloom's glow. A slot a
 * frame has nothing for is bound to an empty image, with its flag in the uniform at 0.
 */
export const finishLayout = oncePerDevice((device: GPUDevice) => {
  const fragment = GPUShaderStage.FRAGMENT
  return device.createBindGroupLayout({
    label: 'Trillion3D display finish',
    entries: [
      computeUniformEntry(0, { minBindingSize: FINISH_BYTES }, fragment),
      computeTextureEntry(1, 'float', '3d', fragment),
      computeTextureEntry(2, 'float', '2d', fragment),
      computeSamplerEntry(3, 'filtering', fragment),
      computeTextureEntry(4, 'float', '2d', fragment),
    ],
  })
})
