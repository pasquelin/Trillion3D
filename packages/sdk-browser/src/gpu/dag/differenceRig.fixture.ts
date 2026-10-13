// A resident cut on the kit's deferred device, whose work runs when it is submitted, through the
// kernels' mirror: each cut writes the lists the test gives it, `dagCutDifference` and `dagCutKeep`
// run on the readout as `difference.fixture.ts` replays them, and copies, writes and readbacks move
// the words the real ones would. A command buffer never submitted runs nothing. What the readbacks
// hold is then the GPU's difference of the lists given, in the order the real dispatch copied them,
// for the host to adopt or not (`dispatch.ts`, `differenceChain.ts`).
import {
  dispatchedEntries,
  fakeDevice,
  type FakeBuffer,
} from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { words } from '../../../../../tests/kit/gpu/mockBuffers.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { packDagSelection } from './selection.ts'
import { mirrorDifferenceStage } from './difference.fixture.ts'
import { OUT_COUNT, OUT_FLAGS, SELECTION_HEADER_WORDS as HEAD } from './layout.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { packed } from './selectionHelpers.fixture.ts'

/** The two lists one cut publishes: the camera's requests, the drawn pages. */
export type RigCut = { asked: number[]; drawn: number[] }

/** `dagMask` and the kernels before the snapshot, as their outputs: `cut` written into `out`, on a
 *  list of `cap` ranks; past it, the readout says it is truncated. */
function writeCut(out: Uint32Array, cap: number, cut: RigCut) {
  const asked = cut.asked.slice(0, cap),
    drawn = cut.drawn.slice(0, cap)
  out.fill(0, 0, 2 * (HEAD + cap))
  out[OUT_COUNT] = cut.asked.length
  out[OUT_FLAGS] = cut.asked.length > cap || cut.drawn.length > cap ? 1 : 0
  out.set(asked, HEAD)
  out[HEAD + cap] = cut.drawn.length
  out.set(drawn, 2 * HEAD + cap)
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

/** `placements` placements of the fixture's primitive, cut on a list of `cap` ranks. */
export async function differenceRig(cap: number, placements = 40) {
  const [root] = packed(dagFixture()).roots
  const dag = packDagSelection(Array.from({ length: placements }, () => root))
  /** The lists the next cut writes. */
  let next: RigCut = { asked: [], drawn: [] }
  const fake = fakeDevice({
    deferred: true,
    // Each kernel runs on the readout and the cap of the dispatch that encoded it.
    kernel: (entry) => {
      const out = words((resources.output as unknown as FakeBuffer).data),
        listCap = resources.listCap
      if (entry !== 'dagPrepare') return () => void mirrorDifferenceStage(entry, out, listCap)
      const cut = next
      return () => writeCut(out, listCap, cut)
    },
  })
  const device = fake.device
  /** The kernels encoded since `encoded` was last read, from the `seen`-th dispatch on. */
  let seen = 0
  const resources = (await createDagResources(device, dag, null, cap))!
  const selection = createDagRuntime(resources)
  return {
    resources,
    selection,
    /** The pages a cut may name: the packed DAG's. */
    pageCount: dag.pageCount,
    /** The next cut writes `cut`. */
    cutNext: (cut: RigCut) => (next = cut),
    /** Snapshots copied into a readback slot so far. */
    copies: () => fake.copies.filter(({ to }) => to.usage & GPUBufferUsage.MAP_READ).length,
    /** The kernels encoded since the last call, flat or indirect. */
    encoded: () => dispatchedEntries(fake.dispatches.slice(seen, (seen = fake.dispatches.length))),
  }
}
