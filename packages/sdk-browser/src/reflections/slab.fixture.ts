import { REFLECTION_VIEW_AT as AT } from './viewLayout.ts'
import type { HeldImage } from './radiance.ts'
import { createReflectionViewWriter } from './viewWrite.ts'

/** The slab words the shipped writer stages for the view-projection `m` of an image of `size`
 *  (`screenSlab` behind `createReflectionViewWriter`). */
export function slabWords(m: ArrayLike<number>, size: readonly [number, number]) {
  let written = new Float32Array(0)
  const device = {
    queue: {
      writeBuffer: (_: unknown, __: number, words: Float32Array) => (written = words.slice()),
    },
  } as unknown as GPUDevice
  const held = { valid: false, viewProjection: new Float64Array(16), size: [0, 0], still: false }
  createReflectionViewWriter(device, {} as GPUBuffer)(
    { viewProjection: m, size, depthDrawn: true, proxyError: 0 },
    held as HeldImage,
    1,
  )
  return [...written.subarray(AT.slab, AT.slab + 4)]
}
