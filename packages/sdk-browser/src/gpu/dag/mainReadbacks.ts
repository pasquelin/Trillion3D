import { createReadbackRing, type ReadbackRing } from '../core/readbackRing.ts'
import { DAG_READBACK_SLOTS } from './layout.ts'
import { admitInto, type CutAdmission, type CutHeld } from './cutBuffers.ts'
import { chainMain, landMain, type MainCopy } from './dispatchRead.ts'

/** A take's buffer, its budget asked by the growth that made room for it (`growDagList`). */
const asked: CutAdmission = () => {}

/**
 * THE MAIN VIEW'S READBACK RING (`../core/readbackRing.ts`): `DAG_READBACK_SLOTS` buffers the
 * frame copies the cut's lists into, read in order behind the reads and growths in flight
 * (`chainMain`), each a buffer of the cut's own — within its `share` (`admitInto`), counted in what
 * it holds (`cutBytes`) —, made with the tables at `bytes`, asked of its budget first, and made
 * again at a take that asks more once the list grew: the growth kept that room in the share and
 * asked the budget for it (`growDagList`), so a frame's copy never moves the pools' funding. A
 * slot refused at the start refuses the cut by name, as any table's; one refused at a later take
 * leaves that frame without a copy, the next asks again.
 */
export function createMainReadbacks(cut: CutHeld, bytes: number): ReadbackRing<MainCopy> {
  // The ring once made counts its buffers (`ReadbackRing.bytes`); while it makes its first ones,
  // they are counted here. Neither is among the cut's lists: both count beside them.
  let ring: ReadbackRing<MainCopy> | undefined,
    first = 0,
    refusal: unknown
  const funded = {
    createBuffer(descriptor: GPUBufferDescriptor) {
      const made = { label: descriptor.label, bytes: descriptor.size },
        build = () => cut.device.createBuffer(descriptor)
      try {
        const beside = ring ? ring.bytes : first
        const buffer = admitInto(cut, made, build, -beside, ring ? asked : cut.admit)
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
