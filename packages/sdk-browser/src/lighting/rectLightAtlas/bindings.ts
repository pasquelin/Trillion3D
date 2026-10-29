import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { computeSamplerEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import type { RectAtlasBindings } from './readWgsl.ts'

/** What a program that reads the rectangle lights' pictures binds: the atlas's view and its trilinear sampler. */
export interface RectAtlasResources {
  readonly view: GPUTextureView
  readonly sampler: GPUSampler
}

/** The two layout entries a program reads the pictures through (`rectSourceWgsl`): the atlas, a filterable 2D texture, and its filtering
 *  sampler, seen by `visibility` (the compute stage by default). */
export const rectAtlasLayoutEntries = (
  b: Pick<RectAtlasBindings, 'atlas' | 'sampler'>,
  visibility?: number,
): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(b.atlas, 'float', '2d', visibility),
  computeSamplerEntry(b.sampler, 'filtering', visibility),
]

/** The two bind group entries that match `rectAtlasLayoutEntries`. */
export const rectAtlasBindEntries = (
  b: Pick<RectAtlasBindings, 'atlas' | 'sampler'>,
  atlas: RectAtlasResources,
): GPUBindGroupEntry[] => [
  { binding: b.atlas, resource: atlas.view },
  { binding: b.sampler, resource: atlas.sampler },
]

/**
 * THE ATLAS OF A SCENE WITH NO PICTURE: one texel of zero and the atlas's sampler, made once a device. A program that reads the
 * pictures is given it where the scene names none; a slot of width 0 never samples it.
 */
export const rectAtlasStandIn = oncePerDevice((device: GPUDevice): RectAtlasResources => ({
  view: standInTexture(device, 'Trillion3D no rect light picture', 'rgba16float').createView(),
  sampler: postSamplers(device).mipped,
}))
