import { computeSamplerEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import type { LightProfileBindings } from './lightProfileText.ts'
import { rectAtlasBindEntries, rectAtlasLayoutEntries } from '../rectLightAtlas/bindings.ts'

/** What a program that reads the light profiles binds: the atlas's view and its sampler, and the rectangle lights' atlas with its
 *  sampler (the atlas of no picture where the scene names none). */
export interface LightProfileResources {
  readonly view: GPUTextureView
  readonly sampler: GPUSampler
  readonly rectView: GPUTextureView
  readonly rectSampler: GPUSampler
}

/**
 * The layout entries a program reads the light profiles through (`lightProfileMultiplierWgsl`):
 * the atlas, a filterable half-float 2D array, and its filtering sampler, seen by `visibility` (the
 * compute stage by default). A program that leaves the profiles out (`NO_LIGHT_PROFILE_WGSL`)
 * binds neither, and spends neither a sampled texture nor a sampler of its stage.
 */
export const lightProfileLayoutEntries = (
  b: Pick<LightProfileBindings, 'atlas' | 'sampler' | 'rectAtlas' | 'rectSampler'>,
  visibility?: number,
): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(b.atlas, 'float', '2d-array', visibility),
  computeSamplerEntry(b.sampler, 'filtering', visibility),
  ...(b.rectAtlas === undefined
    ? []
    : rectAtlasLayoutEntries({ atlas: b.rectAtlas, sampler: b.rectSampler! }, visibility)),
]

/** The two bind group entries that match `lightProfileLayoutEntries`: the atlas's view and sampler. */
export const lightProfileBindEntries = (
  b: Pick<LightProfileBindings, 'atlas' | 'sampler' | 'rectAtlas' | 'rectSampler'>,
  atlas: LightProfileResources,
): GPUBindGroupEntry[] => [
  { binding: b.atlas, resource: atlas.view },
  { binding: b.sampler, resource: atlas.sampler },
  ...(b.rectAtlas === undefined
    ? []
    : rectAtlasBindEntries(
        { atlas: b.rectAtlas, sampler: b.rectSampler! },
        { view: atlas.rectView, sampler: atlas.rectSampler },
      )),
]
