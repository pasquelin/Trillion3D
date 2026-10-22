import type { BloomKernelImage } from '../../../../../../sdk-core/src/contracts/bloomConvolutionOptions.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { BLOOM_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import type { KernelStats } from './kernelStats.ts'
import type { ConvolutionPlan } from './plan.ts'

/** What the convolution reads of its kernel for an image: the transform of the kernel's picture, as
 *  four planes of half spectra (none for a kernel with no light), and what is read of the kernel. */
export interface KernelSpectrum {
  buffer: GPUBuffer | undefined
  stats: KernelStats
  /** The passes encoded to make it: none where it was kept. */
  passes: number
}

/** What the convolution holds of its kernel for an image: the transform made for a kernel and a plan,
 *  and what the answer to the next ask is rewritten into, an image allocating none. */
export function createSpectrumSlot(device: GPUDevice) {
  let held:
    | {
        image: BloomKernelImage
        key: string
        buffer: GPUBuffer | undefined
        stats: KernelStats
        passes: number
      }
    | undefined
  const reply = { buffer: undefined, passes: 0 } as KernelSpectrum
  const drop = () => {
    if (held?.buffer) retire(device, held.buffer)
    held = undefined
  }
  return {
    /** Whether what is held was made for `image` and `plan`. */
    holds: (image: BloomKernelImage, plan: ConvolutionPlan) =>
      held?.image === image && held.key === plan.key,
    /** What was read of the kernel held (`holds`): the reading is the same for the same ask, whether
     *  the transform is kept or made again. */
    get stats() {
      return held!.stats
    },
    /** A buffer for a spectrum of `size` bytes: the one held where it has that size. */
    bufferOf: (size: number) =>
      held?.buffer?.size === size
        ? held.buffer
        : device.createBuffer({ label: BLOOM_PASS, size, usage: GPUBufferUsage.STORAGE }),
    /** Holds the transform `buffer` of `image` for `plan`, `passes` the passes that made it; the
     *  buffer it replaces is given back unless it is this one. */
    keep(
      image: BloomKernelImage,
      plan: ConvolutionPlan,
      buffer: GPUBuffer | undefined,
      stats: KernelStats,
      passes: number,
    ) {
      if (held?.buffer && held.buffer !== buffer) retire(device, held.buffer)
      held = { image, key: plan.key, buffer, stats, passes }
    },
    /** The answer: what is held, `fresh` when it was made for this ask. */
    answer(fresh: boolean) {
      reply.buffer = held!.buffer
      reply.stats = held!.stats
      reply.passes = fresh ? held!.passes : 0
      return reply
    },
    drop,
    get bytes() {
      return held?.buffer?.size ?? 0
    },
  }
}
