import { createReadbackRing, type ReadbackRing } from '../core/readbackRing.ts'
import { DAG_READBACK_SLOTS } from './layout.ts'
import { cutBytes, madeAsked, type CutAdmission } from './cutBuffers.ts'
import { chainMain, landMain, type MainCopy } from './dispatchRead.ts'

/** A take's buffer, its budget asked by the growth that made room for it (`growDagList`). */
const asked: CutAdmission = () => {}

/**
 * THE MAIN VIEW'S READBACK RING (`../core/readbackRing.ts`): `DAG_READBACK_SLOTS` buffers the
 * frame copies the cut's lists into, read in order behind the reads and growths in flight
 * (`chainMain`), each a buffer of the cut's own — within its `share` (`madeAsked`), counted in what
 * it holds (`cutBytes`) —, made with the tables at `bytes`, asked of its budget first, and made
 * again at a take that asks more once the list grew: the growth kept that room in the share and
 * asked the budget for it (`growDagList`), so a frame's copy never moves the pools' funding. A
 * slot refused at the start refuses the cut by name, as any table's; one refused at a later take
 * leaves that frame without a copy, the next asks again.
 */
export function createMainReadbacks(
  device: GPUDevice,
  cut: { buffers: readonly GPUBuffer[]; admit: CutAdmission; share: number },
  bytes: number,
): ReadbackRing<MainCopy> {
  // The ring once made: its buffers count themselves from then on (`cutBytes`).
  const made: { ring?: ReadbackRing<MainCopy> } = {}
  let first = 0,
    refusal: unknown
  const funded = {
    createBuffer(descriptor: GPUBufferDescriptor) {
      // The ring counts its own once made; while it makes its first buffers, they are counted here.
      const held =
        cutBytes({ buffers: cut.buffers, readbacks: made.ring }) + (made.ring ? 0 : first)
      try {
        const buffer = madeAsked(device, made.ring ? asked : cut.admit, held, cut.share, descriptor)
        if (!made.ring) first += buffer.size
        return buffer
      } catch (error) {
        refusal ??= error
        throw error
      }
    },
  }
  const label = 'Trillion3D DAG readback slot',
    count = DAG_READBACK_SLOTS
  const ring = (made.ring = createReadbackRing(
    funded,
    { label, bytes, count, eager: true, chain: chainMain },
    landMain,
  ))
  if (refusal === undefined) return ring
  ring.destroy()
  throw refusal
}
