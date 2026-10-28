import { createGpuPeriodicReadback } from '../../gpu/core/periodicReadback.ts'
import type { TessellationLoss } from '../../../../sdk-core/src/contracts/metrics.ts'
import { LOSS_OCCLUDED, LOSS_QUEUE, LOSS_VISIBLE, LOSS_WINDOWS, LOSS_WORDS } from './contract.ts'
import { TESS_CHAINS } from './uniform.ts'
import type { TessellationResources } from './resources.ts'

/**
 * THE PATCHES THE TESSELLATION LOST (`TessellationLoss`): each chain counts, in four words of its own (`LOSS_*`, the `tess` buffer's last
 * region), the patches its splitting queue, its visible list and the buffer of what its occlusion test hid had no room for, and the windows past its room. One image in fifteen
 * (`createGpuPeriodicReadback`) copies those words as it begins, without waiting for them, and clears them, so that the next sample counts what
 * was lost since; the counts add up over the samples, over the chains.
 */
export function createTessellationLosses(
  device: GPUDevice,
  resources: TessellationResources,
  /** Told of each reading that lost patches, to grow what the next image asks for (`growCapacity`). */
  lost: (sample: TessellationLoss) => void = () => {},
) {
  const at = resources.layout.lost * 4
  const bytes = TESS_CHAINS * LOSS_WORDS * 4
  const total: TessellationLoss = { queue: 0, visible: 0, windows: 0, occluded: 0 }
  const reader = createGpuPeriodicReadback(
    device,
    { label: 'Trillion3D tessellation losses readback', bytes },
    (mapped) => {
      const words = new Uint32Array(mapped)
      const sample: TessellationLoss = { queue: 0, visible: 0, windows: 0, occluded: 0 }
      for (let chain = 0; chain < TESS_CHAINS; chain++) {
        sample.queue += words[chain * LOSS_WORDS + LOSS_QUEUE]!
        sample.visible += words[chain * LOSS_WORDS + LOSS_VISIBLE]!
        sample.windows += words[chain * LOSS_WORDS + LOSS_WINDOWS]!
        sample.occluded += words[chain * LOSS_WORDS + LOSS_OCCLUDED]!
      }
      total.queue += sample.queue
      total.visible += sample.visible
      total.windows += sample.windows
      total.occluded += sample.occluded
      lost(sample)
    },
  )
  let image = 0
  return {
    /** An image begins (the cut's main pass): when it is the one in fifteen, the copy of the losses counted so far, then their clearing. */
    begin(encoder: GPUCommandEncoder) {
      image++
      if (!reader.due(image) || !reader.copy(encoder, resources.tess, at, bytes)) return
      reader.sampled(image)
      encoder.clearBuffer(resources.tess, at, bytes)
    },
    /** The image's commands were submitted: the copy maps. */
    submitted: reader.submitted,
    /** What the samples that came back counted so far; none before the first. */
    stats: (): TessellationLoss | null => (reader.ready ? total : null),
    dispose: reader.dispose,
  }
}
