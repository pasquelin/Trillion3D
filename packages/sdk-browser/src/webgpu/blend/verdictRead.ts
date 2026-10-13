import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { VERDICT, VERDICT_READ_BYTES } from './verdictLayout.ts'

/** Images whose counts can be in flight at once: one an image, never a wait. */
const IN_FLIGHT = 3

/**
 * THE VERDICT'S COUNTS, READ BACK A FEW IMAGES LATE (`../../gpu/core/readbackRing.ts`): the drawn
 * items that drew nothing, the published `blendFrustumRejected`, and the drawn transmissive items
 * the frustum kept, under the verdict's epoch — what moves the verdict's inputs, `blendState
 * .verdictEpoch` — of the image that wrote them. No frame waits: an image whose buffers are all in
 * flight copies nothing. `latest` holds the last counts that came back.
 */
export function createVerdictRead(device: Pick<GPUDevice, 'createBuffer'>) {
  const latest = { epoch: -1, rejected: 0, inView: 0 }
  const ring = createReadbackRing<number>(
    device,
    { label: 'Trillion3D blend verdict readback', bytes: VERDICT_READ_BYTES, count: IN_FLIGHT },
    (mapped, _staging, epoch) => {
      const counts = new Uint32Array(mapped, 0, VERDICT_READ_BYTES / 4)
      latest.epoch = epoch
      latest.rejected = counts[VERDICT.rejected]
      latest.inView = counts[VERDICT.inView]
    },
  )
  return {
    latest,
    /** This image's counts copied from `verdict`, once the verdict is encoded, under `epoch`. */
    copy(encoder: GPUCommandEncoder, verdict: GPUBuffer, epoch: number) {
      const target = ring.take(epoch)
      if (target) encoder.copyBufferToBuffer(verdict, 0, target, 0, VERDICT_READ_BYTES)
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    destroy: () => ring.destroy(),
  }
}
