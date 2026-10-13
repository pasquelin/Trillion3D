import { createReadbackRing, type ReadbackRing } from '../core/readbackRing.ts'
import { DAG_READBACK_SLOTS } from './layout.ts'
import { cutBytes, madeAsked, type CutAdmission } from './cutBuffers.ts'
import { chainMain, landMain, type MainCopy } from './dispatchRead.ts'

/**
 * THE MAIN VIEW'S READBACK RING (`../core/readbackRing.ts`): `DAG_READBACK_SLOTS` buffers the
 * frame copies the cut's lists into, read in order behind the reads and growths in flight
 * (`chainMain`), each a buffer of the cut's own — within its `share`, asked of its budget first
 * (`madeAsked`), counted in what it holds (`cutBytes`) —, made with the tables at `bytes` and made
 * again at a take that asks more once the list grew. A slot the share or the budget refuses at
 * the start refuses the cut by name, as any table's; one refused at a later take leaves that frame
 * without a copy, the next asks again.
 */
export function createMainReadbacks(
  device: GPUDevice,
  cut: { buffers: readonly GPUBuffer[]; admit: CutAdmission; share: number },
  bytes: number,
): ReadbackRing<MainCopy> {
  let ring: ReadbackRing<MainCopy> | undefined,
    first = 0,
    refusal: unknown
  const funded = {
    createBuffer(descriptor: GPUBufferDescriptor) {
      // The ring counts its own once made; while it makes its first buffers, they are counted here.
      const held = cutBytes({ buffers: cut.buffers, readbacks: ring }) + (ring ? 0 : first)
      try {
        const buffer = madeAsked(device, cut.admit, held, cut.share, descriptor)
        if (!ring) first += buffer.size
        return buffer
      } catch (error) {
        refusal ??= error
        throw error
      }
    },
  }
  const label = 'Trillion3D DAG readback slot',
    count = DAG_READBACK_SLOTS
  ring = createReadbackRing(
    funded,
    { label, bytes, count, eager: true, chain: chainMain },
    landMain,
  )
  if (refusal === undefined) return ring
  ring.destroy()
  throw refusal
}
