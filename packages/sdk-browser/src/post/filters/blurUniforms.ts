import { retire } from '../../gpu/core/frameRetire.ts'
import {
  gaussianHalvesWidth,
  gaussianKernel,
  gaussianRadius,
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
/** What a stage's uniforms were written for before the first time: nothing, no value equal to it. */
const UNSET = { percent: NaN, red: NaN, green: NaN, blue: NaN, crossX: NaN, crossY: NaN }

/** What a stage's uniforms are written for: the percent, the tint and the cross of the two passes. */
type Held = typeof UNSET
const heldFor = (percent: number, tint: ArrayLike<number>, cross: readonly number[]): Held => ({
  percent,
  red: tint[0],
  green: tint[1],
  blue: tint[2],
  crossX: cross[0],
  crossY: cross[1],
})
/** Whether `a` and `b` name the same kernel: the same percent and the same cross. */
const sameKernel = (a: Held, b: Held) =>
  a.percent === b.percent && a.crossX === b.crossX && a.crossY === b.crossY
/** Whether `a` and `b` name the same tint. */
const sameTint = (a: Held, b: Held) => a.red === b.red && a.green === b.green && a.blue === b.blue

/** The two buffers of a blur's passes' uniforms. */
const uniformPair = (device: GPUDevice, label: string) =>
  [0, 1].map(() =>
    device.createBuffer({
      label,
      size: BLUR_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  )

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
 *  share `cross` of its pass. */
function fillKernels(reads: BlurReads, radius: number, cross: readonly number[]) {
  reads.axes.forEach((read, pass) => (read.count = gaussianKernel(radius, read.taps, cross[pass])))
}

/**
 * THE TWO PASSES' UNIFORMS OF A BLUR, in the order they run, and what they were written for: the
 * size, the percent, the tint and whether the second pass adds an image. Written again only when
 * one of them changes, the second pass's alone when the tint or `adds` did.
 */
export function createBlurUniforms(device: GPUDevice, edge: Edge, label: string) {
  const words = new Float32Array(BLUR_PARAMS.words)
  const reads = newReads(edge)
  let buffers: GPUBuffer[] = [],
    size = [0, 0, 0],
    held = UNSET
  const corner = [0, 0] // of the first pass's target it draws over: half the width, the height
  const write = (pass: 0 | 1, tint: ArrayLike<number>) => {
    blurWords(words, pass, size, reads, tint)
    device.queue.writeBuffer(buffers[pass], 0, words)
  }
  const release = () => {
    for (const buffer of buffers) retire(device, buffer)
    buffers = []
    size = [0, 0, 0]
    held = UNSET
  }
  return {
    /** The passes' uniforms, none before the first `resize`. */
    get buffers() {
      return buffers
    },
    corner,
    /** Writes what a blur over `percent` of the width of an image `width × height`, tinted, adding an
     *  image when `adds`, its passes' centres given the shares `cross`, asks: nothing when held. */
    resize(
      width: number,
      height: number,
      percent: number,
      tint: ArrayLike<number>,
      adds: boolean,
      cross: readonly number[] = NO_CROSS,
    ) {
      const radius = gaussianRadius(width, percent)
      const half = gaussianHalvesWidth(radius) ? halfOf(width) : width
      const sameSize = size[0] === width && size[1] === height && size[2] === half
      const next = heldFor(percent, tint, cross)
      const kernelHeld = sameSize && sameKernel(held, next)
      if (kernelHeld && sameTint(held, next) && reads.adds === adds) return
      if (!sameSize) {
        release()
        size = [width, height, half]
        corner[0] = half
        corner[1] = height
        buffers = uniformPair(device, label)
      }
      held = next
      reads.adds = adds
      if (!kernelHeld) {
        fillKernels(reads, radius, cross)
        write(0, WHITE)
      }
      write(1, tint)
    },
    release,
  }
}
