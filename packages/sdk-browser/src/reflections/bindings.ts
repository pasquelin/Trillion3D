import { COMPUTE } from '../gpu/core/computeBindings.ts'
import { REFLECTION_FORMAT } from './constants.ts'

/** A compute bind group layout of `entries`. */
export const computeLayout = (device: GPUDevice, entries: GPUBindGroupLayoutEntry[]) =>
  device.createBindGroupLayout({ entries })

/** A write-only storage texture of the reflection's format at `binding`, in a compute stage. */
export const storageEntry = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: COMPUTE,
  storageTexture: { access: 'write-only', format: REFLECTION_FORMAT },
})
