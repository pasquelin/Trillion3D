import { COMPUTE } from '../gpu/core/computeBindings.ts'
import { REFLECTION_FORMAT } from './constants.ts'

/** A write-only storage texture of `format` — the reflection's by default — at `binding`, in a
 *  compute stage. */
export const storageEntry = (
  binding: number,
  format: GPUTextureFormat = REFLECTION_FORMAT,
): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: COMPUTE,
  storageTexture: { access: 'write-only', format },
})
