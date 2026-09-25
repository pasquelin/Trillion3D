import { createDagResidencyUpload } from './residencyUpload.ts';
import { childBase, residentBase, residentFlags } from './layout.ts';
import type { PackedDag } from './types.ts';

/** A device that takes the writes and keeps nothing: the host copy is what the kernel would read. */
const NO_DEVICE = { queue: { writeBuffer() {} } } as unknown as GPUDevice;
const NO_BUFFER = {} as GPUBuffer;

/** Runs the kernel's residency upload (`residencyUpload.ts`) on `packed`, as its host does: the
 *  rule's two bit sets land in `packed.pageCones`, the node counts in `packed.nodes`. */
export function uploadResidency(packed: PackedDag, resident: ArrayLike<number>) {
  const upload = createDagResidencyUpload({
    device: NO_DEVICE,
    packed,
    pageCones: NO_BUFFER,
    nodes: NO_BUFFER,
  });
  upload(resident);
  return upload;
}

/** The cut rule's residency the kernel's host uploads for per-page residency `resident`, read
 *  back from the bit sets it wrote into `packed`: what the oracle is handed. */
export function ruleResidency(packed: PackedDag, resident: ArrayLike<number>) {
  uploadResidency(packed, resident);
  const bits = new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCones.length,
    ),
    pageCount = packed.pageCount;
  return {
    ready: residentFlags(bits, pageCount, residentBase(pageCount)),
    childReady: residentFlags(bits, pageCount, childBase(pageCount)),
  };
}
