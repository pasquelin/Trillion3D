import { retire } from './frameRetire.ts'

/** What an image does with its occlusion: tests it (`follow`); tests it in a view drawn aside of a
 *  frozen cut, the kept verdicts left alone (`aside`); or, the main view's cut frozen, draws the
 *  verdicts it kept again, testing only to keep them first (`held`). */
export type CullStep = 'follow' | 'aside' | 'held'

/**
 * A buffer's words kept aside while the main view's cut is frozen (`../../webgpu/pages/render/
 * cutFreeze.ts`): the verdicts the frozen image tested, which the views drawn aside overwrite in the
 * buffers they share, put back before each frozen image reads them. The copy names the buffer it
 * was taken from: a buffer a growth made again puts nothing back.
 */
export function createHeldCopy(device: GPUDevice, label: string) {
  let copy: GPUBuffer | undefined, of: GPUBuffer | undefined
  return {
    /** `live`'s words copied aside, in the encoder's order. */
    keep(encoder: GPUCommandEncoder, live: GPUBuffer) {
      if (copy?.size !== live.size) {
        if (copy) retire(device, copy)
        copy = device.createBuffer({
          label,
          size: live.size,
          usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        })
      }
      encoder.copyBufferToBuffer(live, 0, copy, 0, live.size)
      of = live
    },
    /** The words kept put back into `live`; false when none were kept from it as it is now — a
     *  table grown while the cut is frozen holds a buffer of its own. */
    restore(encoder: GPUCommandEncoder, live: GPUBuffer) {
      if (!copy || of !== live || copy.size !== live.size) return false
      encoder.copyBufferToBuffer(copy, 0, live, 0, live.size)
      return true
    },
    /** Bytes `[offset, offset + size)` of the copy zeroed: a row reused while the cut is frozen. */
    clear(encoder: GPUCommandEncoder, offset: number, size: number) {
      if (!copy || offset >= copy.size) return
      encoder.clearBuffer(copy, offset, Math.min(size, copy.size - offset))
    },
    /** The copy released: the cut follows the camera again. */
    drop() {
      if (copy) retire(device, copy)
      copy = of = undefined
    },
  }
}
export type HeldCopy = ReturnType<typeof createHeldCopy>
