import { createReadbackRing, type ReadbackRing } from '../../gpu/core/readbackRing.ts'
import { DAG_READBACK_SLOTS } from './layout.ts'
import { admitInto, type CutHeld } from './cut/cutBuffers.ts'
import { chainMain, landMain, type MainCopy } from './dispatchRead.ts'

/**
 * THE MAIN VIEW'S READBACK RING (`../../gpu/core/readbackRing.ts`): `DAG_READBACK_SLOTS` buffers the
 * frame copies the cut's lists into, read in order behind the reads and the tables made again in
 * flight (`chainMain`), each a buffer of the cut's own — within its `share` (`admitInto`), counted
 * in what it holds (`cutBytes`) —, made with the tables at `bytes`, asked of its budget first: a
 * readout made for other ranks (`lists/listGrowth.ts`) has its slots made again as they are next
 * taken, within the room its growth kept in the share and asked of the budget, so a frame's copy
 * never moves the pools' funding. A slot refused at the start refuses the cut by name, as any
 * table's; one refused at a later take leaves that frame without a copy, the next asks again.
 */
export function createMainReadbacks(cut: CutHeld, bytes: number): ReadbackRing<MainCopy> {
  let ring: ReadbackRing<MainCopy> | undefined = undefined,
    first = 0,
    refusal: unknown
  // The cut as its ring is admitted in: its tables, and the ring's buffers beside them — counted
  // here while it makes its first ones, then by the ring (`ReadbackRing.bytes`); the budget asked
  // for each one it makes.
  const held: CutHeld = {
    buffers: cut.buffers,
    textures: cut.textures,
    readbacks: {
      get bytes() {
        return ring ? ring.bytes : first
      },
    },
    device: cut.device,
    // The budget is asked for the first slots alone: a growth asked for the rest (`growDagList`).
    admit: (bytes) => {
      if (!ring) cut.admit(bytes)
    },
    share: cut.share,
  }
  const funded = {
    createBuffer(descriptor: GPUBufferDescriptor) {
      const made = { label: descriptor.label, bytes: descriptor.size },
        build = () => cut.device.createBuffer(descriptor)
      try {
        const buffer = admitInto(held, made, build)
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
