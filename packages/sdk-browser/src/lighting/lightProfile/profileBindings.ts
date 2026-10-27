import { computeSamplerEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import type { LightProfileAtlas } from './profileAtlas.ts'
import type { LightProfileBindings } from './lightProfileWgsl.ts'

/**
 * The two layout entries a program reads the light profiles through (`lightProfileMultiplierWgsl`):
 * the atlas, a filterable half-float 2D array, and its filtering sampler, seen by `visibility` (the
 * compute stage by default). A program that leaves the profiles out (`NO_LIGHT_PROFILE_WGSL`)
 * binds neither, and spends neither a sampled texture nor a sampler of its stage.
 */
export const lightProfileLayoutEntries = (
  b: Pick<LightProfileBindings, 'atlas' | 'sampler'>,
  visibility?: number,
): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(b.atlas, 'float', '2d-array', visibility),
  computeSamplerEntry(b.sampler, 'filtering', visibility),
]

/** The two bind group entries that match `lightProfileLayoutEntries`: the atlas's view and sampler. */
export const lightProfileBindEntries = (
  b: Pick<LightProfileBindings, 'atlas' | 'sampler'>,
  atlas: Pick<LightProfileAtlas, 'view' | 'sampler'>,
): GPUBindGroupEntry[] => [
  { binding: b.atlas, resource: atlas.view },
  { binding: b.sampler, resource: atlas.sampler },
]
