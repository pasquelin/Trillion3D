import { computeStorageTextureEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { ATLAS_TEXTURE_FORMAT } from './layout.ts'

/** The layout entry of the binding a program reads the light functions through
 *  (`lightFunctionReadWgsl`), seen by `visibility` (the compute stage by default): the one place its kind is written, for every
 *  pass that reads them. The atlas holds words, read by load alone: a sampled texture, or, `storage`,
 *  a read-only storage texture, which spends none of the sixteen sampled textures of a stage
 *  (`loadOnlyTarget`) — the pass that has no sampled texture to spare asks for it. */
export const lightFunctionLayoutEntry = (
  binding: number,
  visibility?: number,
  storage = false,
): GPUBindGroupLayoutEntry =>
  storage
    ? computeStorageTextureEntry(binding, ATLAS_TEXTURE_FORMAT, 'read-only', '2d', visibility)
    : computeTextureEntry(binding, 'uint', '2d', visibility)
