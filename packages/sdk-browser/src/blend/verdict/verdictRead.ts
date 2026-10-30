import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { commitOnSubmit, onSettled, retire } from '../../gpu/core/frameRetire.ts'
import { FRUSTUM_PLANE_VALUES } from '../../../../math/src/geometry/frustum/frustum.ts'
import { VERDICT, VERDICT_READ_BYTES } from './verdictLayout.ts'

/** Images whose counts can be in flight at once for a view: one an image, never a wait. */
const IN_FLIGHT = 3

/**
 * THE VERDICT'S COUNTS OF ONE VIEW, READ BACK A FEW IMAGES LATE (`../../gpu/core/readbackRing.ts`): the drawn
 * items that drew nothing, the published `blendFrustumRejected`, and the drawn transmissive items
 * the frustum kept, under the view's `epoch` — what moved the inputs its verdict read — of the image that
 * wrote them. No frame waits: an image whose buffers are all in flight copies nothing. `latest` holds the
 * last counts that came back; `judged` the frustum planes and `cuts` the sky cut words the view's last verdict used, `seen` the scene's
 * `verdictEpoch` it last followed.
 */
export type ViewVerdict = {
  latest: { epoch: number; rejected: number; inView: number }
  judged: Float64Array
  cuts: Uint32Array
  seen: number
  epoch: number
  ring: ReturnType<typeof createReadbackRing<number>>
}

/** The verdict readbacks, one slot for each view (`viewKey`) that asks its counts: the main image and each planar view relevance-test their own frustum. */
export function createVerdictRead(device: GPUDevice) {
  const slots = new Map<object, ViewVerdict>()
  const made = (cutWords: number): ViewVerdict => {
    const latest = { epoch: -1, rejected: 0, inView: 0 }
    return {
      latest,
      judged: new Float64Array(FRUSTUM_PLANE_VALUES),
      cuts: new Uint32Array(cutWords),
      seen: -1,
      epoch: 0,
      ring: createReadbackRing<number>(
        device,
        { label: 'Trillion3D blend verdict readback', bytes: VERDICT_READ_BYTES, count: IN_FLIGHT },
        (mapped, _staging, epoch) => {
          const counts = new Uint32Array(mapped, 0, VERDICT_READ_BYTES / 4)
          latest.epoch = epoch
          latest.rejected = counts[VERDICT.rejected]
          latest.inView = counts[VERDICT.inView]
        },
      ),
    }
  }
  return {
    /** The slot of the view under `key`, made with its first image, its sky cut sized to `cutWords` (the scene's, which only a remount changes: it makes new slots). */
    of(key: object, cutWords = 0) {
      let slot = slots.get(key)
      if (!slot) slots.set(key, (slot = made(cutWords)))
      return slot
    },
    /** The slot of the view under `key` if it has one: it never makes one. */
    peek: (key: object) => slots.get(key),
    /** The view's counts copied from `verdict`, once the verdict is encoded, under the slot's epoch: the buffer maps when `encoder` is submitted, and is free again if it is dropped. A view whose copy another open encoder carries copies nothing: a buffer is never named by two encoders. */
    copy(encoder: GPUCommandEncoder, verdict: GPUBuffer, slot: ViewVerdict) {
      if (slot.ring.pending() > 0) return
      const target = slot.ring.take(slot.epoch)
      if (!target) return
      encoder.copyBufferToBuffer(verdict, 0, target, 0, VERDICT_READ_BYTES)
      // The one copy a slot has open: settling all of the ring's pending buffers settles it alone.
      commitOnSubmit(encoder, slot.ring.submitted)
      onSettled(encoder, slot.ring.dropped)
    },
    /** The view under `key` is removed: its readback buffers go once the commands that name them are done. */
    release(key: object) {
      const slot = slots.get(key)
      if (!slot) return
      slots.delete(key)
      retire(device, slot.ring)
    },
    /** Every view's buffers go once the commands that name them are done, as a removed view's. */
    destroy() {
      for (const slot of slots.values()) retire(device, slot.ring)
      slots.clear()
    },
  }
}
