// A runtime of `count` placements of `pages` pages each, whose buffer of words (`rootWords.ts`) is
// written into a fake device and replayed onto the GPU's own copy: what the tests of what the host
// sends read.
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { replayWrites } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { createShadowMobility } from './mobility.ts'
import { uploadRootWords } from './rootWords.ts'
import { ROOT_SECTION, ROOT_SECTIONS } from './rootWordsWgsl.ts'

export function rootWordsTwin(count: number, pages = 1) {
  const roots: Array<{ world: { elements: Float64Array }; pages: object[]; deformReach?: number }> =
    Array.from({ length: count }, () => ({
      world: { elements: new Float64Array(16) },
      pages: new Array(pages).fill({}),
    }))
  const { device, writes } = fakeDevice()
  const context: { shadowCacheDeformableMeshesInvalidate?: boolean } = {}
  const rt = {
    layout: { selectionRoots: roots, placement: { packedCount: count * pages } },
    lights: { mobility: createShadowMobility() },
    vis: { rootOffsets: { rowOf: () => undefined } },
    context,
    gpu: { device },
  } as unknown as WebgpuPagesRuntime
  const bytes = new ArrayBuffer(ROOT_SECTIONS * count * 4 + 32)
  /** Whether a write is of the words' section, the first (the others go after it). */
  const inWords = ({ offset }: { offset?: number }) =>
    (offset ?? 0) < ROOT_SECTION.state * count * 4
  /** The words written since the last call (a write's `size` counts words), held on the GPU's copy. */
  const sent = () => {
    const words = writes.filter(inWords).reduce((sum, { size }) => sum + size!, 0)
    replayWrites(bytes, writes)
    return words
  }
  const held = () => {
    sent()
    return [...new Uint32Array(bytes)].slice(0, count)
  }
  /** The reach section the GPU holds. */
  const reach = () => {
    sent()
    const at = ROOT_SECTION.reach * count
    return [...new Float32Array(bytes)].slice(at, at + count)
  }
  const upload = () => uploadRootWords(rt, device)
  return { rt, roots, context, held, sent, reach, upload, writes, inWords }
}
