import { createDagResidencyUpload } from './residencyUpload.ts'
import { childBase, residentBase } from './layout.ts'
import type { PackedDag } from './types.ts'
import type { PageResidency } from '../core/selection.ts'
import { residentFlags } from './layout.fixture.ts'

/** A device that takes the writes and keeps nothing: the host copy is what the kernel would read. */
const NO_DEVICE = { queue: { writeBuffer() {} } } as unknown as GPUDevice
const NO_PARTS = { buffers: [{} as GPUBuffer], bytes: Number.MAX_SAFE_INTEGER }

/** Runs the kernel's residency upload (`residencyUpload.ts`) on `packed`, as its host does: the
 *  rule's two bit sets land in `packed.pageCones`, the open counts the placements hold in
 *  `packed.heldOpen`. */
export function uploadResidency(packed: PackedDag, resident: ArrayLike<number> | PageResidency) {
  const upload = createDagResidencyUpload({
    device: NO_DEVICE,
    packed,
    coldParts: NO_PARTS,
  })
  upload('flag' in resident ? resident : pageResidency(resident))
  return upload
}

/** The flags of `resident` from page `from` on, as an array. */
export const residencySlice = (resident: PageResidency, from: number) =>
  Uint8Array.from({ length: resident.length - from }, (_, i) => resident.flag(from + i))

/** Per-page residency `values` as the cut reads it (`PageResidency`): an absent page reads 0. */
export const pageResidency = (values: ArrayLike<number>): PageResidency => ({
  length: values.length,
  flag: (page) => values[page] ?? 0,
})

/** The cut rule's residency the kernel's host uploads for per-page residency `resident`, read
 *  back from the bit sets it wrote into `packed`: what the oracle is handed. */
export function ruleResidency(packed: PackedDag, resident: ArrayLike<number> | PageResidency) {
  uploadResidency(packed, resident)
  const bits = new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCones.length,
    ),
    pageCount = packed.pageCount
  return {
    ready: residentFlags(bits, pageCount, residentBase(pageCount)),
    childReady: residentFlags(bits, pageCount, childBase(pageCount)),
  }
}
