import { createDagResidencyUpload } from './residencyUpload.ts'
import { childBase } from './layout.ts'
import type { PackedDag } from './types.ts'
import type { PageResidency } from '../../gpu/core/selection.ts'
import { residentFlags } from './layout.fixture.ts'

/** A device that takes the writes and keeps nothing: the host copy is what the kernel would read. */
const NO_DEVICE = { queue: { writeBuffer() {} } } as unknown as GPUDevice

/** Runs the kernel's residency upload (`residencyUpload.ts`) on `packed`, as its host does: the
 *  rule's two bit sets land in `packed.coldWords`, the open counts the placements hold in
 *  `packed.heldOpen`. */
export function uploadResidency(packed: PackedDag, resident: ArrayLike<number> | PageResidency) {
  const upload = createDagResidencyUpload({
    device: NO_DEVICE,
    packed,
    cold: () => {},
  })
  upload('flag' in resident ? resident : pageResidency(resident))
  return upload
}

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
      packed.coldWords.buffer,
      packed.coldWords.byteOffset,
      packed.coldWords.length,
    ),
    pageCount = packed.pageCount
  return {
    ready: residentFlags(bits, pageCount, 0),
    childReady: residentFlags(bits, pageCount, childBase(pageCount)),
  }
}
