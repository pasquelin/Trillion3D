import { COMPUTE } from '../gpu/core/computeBindings.ts'
import { REFLECTION_FORMAT } from './constants.ts'

/** A write-only storage texture of the reflection's format at `binding`, in a compute stage. */
export const storageEntry = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: COMPUTE,
  storageTexture: { access: 'write-only', format: REFLECTION_FORMAT },
})

/** The run-time proxy's store at `binding`: two layers of `r32uint`, read and written by the trace. */
export const storeEntry = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: COMPUTE,
  storageTexture: { access: 'read-write', format: 'r32uint', viewDimension: '2d-array' },
})
