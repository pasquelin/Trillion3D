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
/** The tint of a blur that tints nothing. */
export const WHITE = [1, 1, 1] as const
/** What a stage's uniforms were written for before the first time: nothing, no value equal to it. */
const UNSET = { percent: NaN, red: NaN, green: NaN, blue: NaN }

/** Whether `tint` is the one `held` was written with. */
const sameTint = (held: typeof UNSET, tint: ArrayLike<number>) =>
  held.red === tint[0] && held.green === tint[1] && held.blue === tint[2]

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
 *  reads — their count and their offsets and weights. */
type BlurReads = {
  edge: number
  adds: boolean
  count: number
  taps: ReturnType<typeof gaussianTapsOf>
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
  const { taps, count } = reads
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

/**
 * THE TWO PASSES' UNIFORMS OF A BLUR, in the order they run, and what they were written for: the
 * size, the percent, the tint and whether the second pass adds an image. Written again only when
 * one of them changes, the second pass's alone when the tint or `adds` did.
 */
export function createBlurUniforms(
  device: GPUDevice,
  edge: keyof typeof BLUR_EDGES,
  label: string,
) {
  const words = new Float32Array(BLUR_PARAMS.words)
  const reads: BlurReads = { edge: BLUR_EDGES[edge], adds: false, count: 0, taps: gaussianTapsOf() }
  let buffers: GPUBuffer[] = [],
    size = [0, 0, 0],
    held = UNSET
  // The corner of the first pass's target it draws over: half the width, the height.
  const corner = [0, 0]
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
    /** Writes what an image of `width × height` texels blurred over `percent` of its width, its
     *  reads weighted by `tint` and the second pass adding an image when `adds`, asks of the
     *  uniforms: nothing when they hold it already; the buffers are made again when the size
     *  moved. */
    resize(width: number, height: number, percent: number, tint: ArrayLike<number>, adds: boolean) {
      const radius = gaussianRadius(width, percent)
      const half = gaussianHalvesWidth(radius) ? halfOf(width) : width
      const sameKernel = size[0] === width && size[1] === height && size[2] === half
      const sameWeights = sameTint(held, tint) && reads.adds === adds
      if (sameKernel && held.percent === percent && sameWeights) return
      if (!sameKernel) {
        release()
        size = [width, height, half]
        corner[0] = half
        corner[1] = height
        buffers = uniformPair(device, label)
      }
      const kernelMoved = !sameKernel || held.percent !== percent
      held = { percent, red: tint[0], green: tint[1], blue: tint[2] }
      reads.adds = adds
      if (kernelMoved) {
        reads.count = gaussianKernel(radius, reads.taps)
        write(0, WHITE)
      }
      write(1, tint)
    },
    release,
  }
}
