import type { GaussianBlurValues } from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { uniformBlock, type UniformBlock } from '../../gpu/core/uniformBlock.ts'
import {
  gaussianHalvesWidth,
  gaussianKernel,
  gaussianRadius,
  gaussianTapCap,
  gaussianTapsOf,
} from './gaussianKernel.ts'
import { BLUR_BYTES, BLUR_EDGES, BLUR_PARAMS } from './gaussianWgsl.ts'
import { halfOf } from './levelSizes.ts'

const AT = BLUR_PARAMS.at
/** How a blur takes a read past the image's edge (`BLUR_EDGES`). */
type Edge = keyof typeof BLUR_EDGES
/** The tint of a blur that tints nothing. */
export const WHITE = [1, 1, 1] as const
/** The cross a blur has when its stage is given none: the plain bell on both axes. */
export const NO_CROSS = [0, 0] as const
/** What a stage's uniforms are written for: the percent, the tint and the cross of the two passes, and
 *  how the kernel is sized (`GaussianBlurValues`: the sample scale and the loop mode). */
type Held = {
  percent: number
  red: number
  green: number
  blue: number
  crossX: number
  crossY: number
  scale: number
  loop: number
}
/** What a stage's uniforms were written for before the first time: nothing, no value equal to it. */
const unset = (): Held => ({
  percent: NaN,
  red: NaN,
  green: NaN,
  blue: NaN,
  crossX: NaN,
  crossY: NaN,
  scale: NaN,
  loop: NaN,
})

/** Writes into `held` what the stage's uniforms are about to be written for. */
function remember(
  held: Held,
  percent: number,
  tint: ArrayLike<number>,
  cross: readonly number[],
  look: GaussianBlurValues,
) {
  held.percent = percent
  held.red = tint[0]
  held.green = tint[1]
  held.blue = tint[2]
  held.crossX = cross[0]
  held.crossY = cross[1]
  held.scale = look.gaussianSampleScale
  held.loop = look.gaussianLoopMode
}

/** The width the first pass writes: half the image's from the radius `look` names, else its own. */
const firstPassWidth = (width: number, radius: number, look: GaussianBlurValues) =>
  gaussianHalvesWidth(radius, look.gaussianFastBlurThreshold) ? halfOf(width) : width

/** Whether the kernels `held` were written for are the ones `percent`, `cross` and `look` ask. */
const sameKernel = (
  held: Held,
  percent: number,
  cross: readonly number[],
  look: GaussianBlurValues,
) =>
  held.percent === percent &&
  held.crossX === cross[0] &&
  held.crossY === cross[1] &&
  held.scale === look.gaussianSampleScale &&
  held.loop === look.gaussianLoopMode

/** The two uniform blocks of a blur's passes. */
const uniformPair = (device: GPUDevice, label: string) =>
  [0, 1].map(() => uniformBlock(device, label, BLUR_BYTES))

/** What the passes' uniforms are written from beside the image's size and the tint: how a read
 *  past the image is taken (`BLUR_EDGES`), whether the second pass adds an image, and the kernel's
 *  reads of each pass — their count and their offsets and weights; the two differ where the cross
 *  gives the passes different centres. */
type BlurReads = {
  edge: number
  adds: boolean
  axes: readonly { count: number; taps: ReturnType<typeof gaussianTapsOf> }[]
}

/**
 * Writes into `words` the uniform of pass `pass` of a blur of an image `size` — its width, its
 * height and the width of the narrow image the first pass writes —: 0 along x, reading the image
 * and writing the first `half` columns of the narrow target, 1 along y, reading those and writing
 * the image's size; its reads weighted by `tint`.
 */
function blurWords(
  words: Float32Array,
  pass: 0 | 1,
  [width, height, half]: readonly number[],
  reads: BlurReads,
  tint: ArrayLike<number>,
) {
  const { taps, count } = reads.axes[pass]
  words.fill(0)
  words[AT.axis + pass] = 1 / (pass ? height : width)
  words[AT.inTexel] = 1 / (pass ? half : width)
  words[AT.inTexel + 1] = 1 / height
  words[AT.outTexel] = 1 / (pass ? width : half)
  words[AT.outTexel + 1] = 1 / height
  words[AT.scale] = pass ? half / width : 1
  words[AT.scale + 1] = 1
  words[AT.count] = count
  words[AT.edge] = reads.edge
  words[AT.plus] = pass && reads.adds ? 1 : 0
  for (let i = 0; i < count; i++) {
    words[AT.taps + 4 * i] = taps.offsets[i]
    for (let c = 0; c < 3; c++) words[AT.taps + 4 * i + 1 + c] = taps.weights[i] * tint[c]
  }
}

/** The reads of a blur with the edge `edge`: none made yet, a kernel for each pass. */
function newReads(edge: Edge): BlurReads {
  const axis = () => ({ count: 0, taps: gaussianTapsOf() })
  return { edge: BLUR_EDGES[edge], adds: false, axes: [axis(), axis()] }
}

/** Fills the kernel of each pass of `reads` for a blur of `radius` texels, the centre given the
 *  share `cross` of its pass, the reach and the most reads as `look` sizes them. */
function fillKernels(
  reads: BlurReads,
  radius: number,
  cross: readonly number[],
  look: GaussianBlurValues,
) {
  const cap = gaussianTapCap(look.gaussianLoopMode)
  reads.axes.forEach(
    (read, pass) =>
      (read.count = gaussianKernel(radius, read.taps, cross[pass], look.gaussianSampleScale, cap)),
  )
}

/**
 * THE TWO PASSES' UNIFORMS OF A BLUR, in the order they run, and what they were written for: the
 * size, the percent, the tint, how the kernel is sized (`GaussianBlurValues`) and whether the second
 * pass adds an image. Written again only when one of them changes, the second pass's alone when
 * the tint or `adds` did, and then only the words that changed (`uniformBlock`). The two blocks are
 * made at the first `resize` and kept — a size moves words, not buffers —, given back by `release`.
 */
export function createBlurUniforms(device: GPUDevice, edge: Edge, label: string) {
  const reads = newReads(edge)
  const blocks: UniformBlock[] = [],
    buffers: GPUBuffer[] = [] // of the blocks: a frame reads them
  let size = [0, 0, 0],
    held = unset()
  const corner = [0, 0] // of the first pass's target it draws over: half the width, the height
  const write = (pass: 0 | 1, tint: ArrayLike<number>) => {
    blurWords(blocks[pass].words.f, pass, size, reads, tint)
    blocks[pass].send()
  }
  const release = () => {
    for (const { buffer } of blocks) retire(device, buffer)
    blocks.length = buffers.length = 0
    size = [0, 0, 0]
    held = unset()
  }
  return {
    /** The passes' uniforms, none before the first `resize`. */
    buffers,
    corner,
    /** Writes what a blur over `percent` of the width of an image `width × height` asks — the first
     *  pass halved from the radius `look` names, its kernel sized as `look` says —, tinted, adding
     *  an image when `adds`, the centres given the shares `cross`: nothing, and no allocation, when
     *  held. */
    resize(
      width: number,
      height: number,
      percent: number,
      look: GaussianBlurValues,
      tint: ArrayLike<number>,
      adds: boolean,
      cross: readonly number[] = NO_CROSS,
    ) {
      const radius = gaussianRadius(width, percent)
      const half = firstPassWidth(width, radius, look)
      const sameSize = size[0] === width && size[1] === height && size[2] === half
      const kernelHeld = sameSize && sameKernel(held, percent, cross, look)
      const tintHeld = held.red === tint[0] && held.green === tint[1] && held.blue === tint[2]
      if (kernelHeld && tintHeld && reads.adds === adds) return
      if (!blocks.length) {
        blocks.push(...uniformPair(device, label))
        buffers.push(...blocks.map(({ buffer }) => buffer))
      }
      if (!sameSize) {
        size = [width, height, half]
        corner[0] = half
        corner[1] = height
      }
      remember(held, percent, tint, cross, look)
      reads.adds = adds
      if (!kernelHeld) {
        fillKernels(reads, radius, cross, look)
        write(0, WHITE)
      }
      write(1, tint)
    },
    release,
  }
}
