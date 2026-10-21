import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { HIZ_FORMAT } from './pyramidTexture.ts'

/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * GPU proofs READ them here — none copies them, so none can lag behind the shader: the pyramid,
 * level 0 and the build pass's uniform slot.
 */
export function hizBindEntries(uniformBytes: number): GPUBindGroupLayoutEntry[] {
  return [
    computeStorageTextureEntry(0, HIZ_FORMAT, 'read-write', '2d-array'),
    computeTextureEntry(1, 'unfilterable-float', '2d-array'),
    computeUniformEntry(2, { hasDynamicOffset: true, minBindingSize: uniformBytes }),
  ]
}
