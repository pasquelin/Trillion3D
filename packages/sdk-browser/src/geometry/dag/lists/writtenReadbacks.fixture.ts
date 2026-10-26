// A cut whose readbacks stand for what its kernels would have written: the kit's device, its
// kernels idle, maps each readback with the readout the lists a test gives hold — the camera's
// requests and the drawn pages — on a list of the cut's cap, for the host to adopt or not
// (`dispatch.ts`, `../cut/adoption/adoption.ts`).
import { OUT_COUNT, OUT_FLAGS } from '../layout.ts'
import { SELECTION_HEADER_WORDS, countWord } from '../readoutWords.ts'

/** The two lists one cut publishes: the camera's requests, a leaf of one page each, and the drawn
 *  pages. */
export type RigCut = { asked: number[]; drawn: number[] }

/** The cut's kernels as their outputs: `cut` written into `out`, on a list of `cap` ranks; past it,
 *  the readout says it is truncated. */
function writeCut(out: Uint32Array, cap: number, cut: RigCut) {
  const asked = cut.asked.slice(0, cap),
    drawn = cut.drawn.slice(0, cap)
  out.fill(0, 0, 2 * (SELECTION_HEADER_WORDS + cap))
  out[OUT_COUNT] = cut.asked.length
  out[OUT_FLAGS] = cut.asked.length > cap || cut.drawn.length > cap ? 1 : 0
  out.set(asked, SELECTION_HEADER_WORDS)
  out.fill(1, countWord(cap), countWord(cap) + asked.length)
  out[SELECTION_HEADER_WORDS + cap] = cut.drawn.length
  out.set(drawn, 2 * SELECTION_HEADER_WORDS + cap)
}

/** Kernels that run nothing (`FakeDeviceOptions.kernel`): the readbacks stand for what they write. */
export const idleKernels = () => () => {}

/** `device`'s readbacks map what the kernels would have written for `lists()` on a list of its
 *  cap; its kernels are `idleKernels`. */
export function writtenReadbacks(device: GPUDevice, lists: () => { cap: number; cut: RigCut }) {
  const create = device.createBuffer.bind(device)
  device.createBuffer = (descriptor: GPUBufferDescriptor) => {
    const buffer = create(descriptor)
    if (descriptor.usage & GPUBufferUsage.MAP_READ)
      buffer.getMappedRange = () => {
        const bytes = new ArrayBuffer(descriptor.size),
          { cap, cut } = lists()
        writeCut(new Uint32Array(bytes), cap, cut)
        return bytes
      }
    return buffer
  }
}
