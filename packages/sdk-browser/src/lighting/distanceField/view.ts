import {
  clipmapMipResolution,
  clipmapResolution,
  OCCLUSION_CONE_HALF_ANGLE,
  pageTableClipmapResolution,
  GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS as INFLUENCE_VOXELS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
  COMPUTE,
} from '../../gpu/core/computeBindings.ts'
import { GDF_VIEW } from './globalReadWgsl.ts'
import type { GlobalResources } from './globalResources.ts'
import type { ClipmapPlan } from './updateRegions.ts'
import type { Vec3 } from './regionBounds.ts'

/**
 * WHAT A SHADER NEEDS TO FIND A POSITION IN THE GLOBAL DISTANCE FIELD, written from the clipmaps'
 * places (`globalReadWgsl.ts` reads it): for each clipmap its centre carried to the translated world
 * — the camera at the origin — and its half-extent; the position-to-volume coordinate, scroll
 * included; the position-to-mip coordinate, the mip's layers the clipmap owns held to their middle
 * for a bilinear read; then the counts, the texel, the farthest a cone is traced, the mip's divider
 * and the distance at which the pages take over from the mip, and the translation from the world.
 * All zero where the field holds no clipmap: the shader then answers as a scene without a distance
 * field does.
 */

/** Writes the view block of `plans` (the clipmaps of the movable cache, all of them) at word `at`
 *  of `words`, for a camera at `origin` (centimetres) and the sky light's `occlusionDistance`. */
export function writeGdfView(
  words: Float32Array,
  at: number,
  settings: GlobalDistanceFieldSettings,
  plans: readonly ClipmapPlan[],
  origin: Vec3,
  occlusionDistance: number,
) {
  const field = GDF_VIEW.at
  words.fill(0, at, at + GDF_VIEW.words)
  if (!plans.length) return
  const ints = new Uint32Array(words.buffer, words.byteOffset + at * 4, GDF_VIEW.words)
  const count = plans.length
  const mip = clipmapMipResolution(settings)
  plans.forEach((plan, k) => {
    const size = 2 * plan.extent
    const centre = plan.center.map((c, a) => c - origin[a])
    words.set([...centre, plan.extent], at + field.centerExtent + 4 * k)
    words.set(
      [...plan.scroll.map((s, a) => (s - centre[a]) / size + 0.5), 1 / size],
      at + field.uvAddMul + 4 * k,
    )
    const min = centre.map((c) => c - plan.extent)
    words.set(
      [1 / size, 1 / size, 1 / size / count, (k * mip + 0.5) / (mip * count)],
      at + field.mipScale + 4 * k,
    )
    words.set(
      [
        -min[0] / size,
        -min[1] / size,
        (-min[2] / size + k) / count,
        (k * mip + mip - 0.5) / (mip * count),
      ],
      at + field.mipBias + 4 * k,
    )
  })
  ints[field.clipmaps] = count
  ints[field.pagesAlong] = pageTableClipmapResolution(settings)
  words[at + field.texel] = 1 / clipmapResolution(settings)
  const outer = plans[count - 1]
  const reach = (INFLUENCE_VOXELS * 2 * outer.extent) / clipmapResolution(settings)
  words[at + field.maxConeDistance] = Math.min(
    occlusionDistance / (1 + Math.tan(OCCLUSION_CONE_HALF_ANGLE)),
    reach,
  )
  const factor = settings.globalDistanceFieldMipFactor
  words[at + field.mipFactor] = factor
  words[at + field.mipTransition] =
    (INFLUENCE_VOXELS + factor / INFLUENCE_VOXELS) / (2 * INFLUENCE_VOXELS)
  words[at + field.occlusionDistance] = occlusionDistance
  origin.forEach((c, a) => (words[at + field.translation + a] = -c))
}

/** What the reads bind of the field's resources: the table they read, the atlas, the coarse mip. */
export type ReadResources = Pick<GlobalResources, 'read' | 'atlas' | 'mip'>

/** What a pass that reads the global field takes from the scene (`DistanceFieldScene`): the bind group entries of the
 *  reads' bindings from `first`, and the generation that says they changed, whereupon its group is made again. */
export interface GlobalFieldRead {
  readEntries(first: number): GPUBindGroupEntry[]
  readonly readGeneration: number
}

/** The layout entries of the reads' bindings from `first`: the view block, the page table (load), the
 *  atlas, the coarse mip (load). */
export const globalReadLayoutEntries = (
  first: number,
  visibility = COMPUTE,
): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(first, { minBindingSize: GDF_VIEW.words * 4 }, visibility),
  computeTextureEntry(first + 1, 'uint', '3d', visibility),
  computeBufferEntry(first + 2, 'read-only-storage', visibility),
  computeTextureEntry(first + 3, 'unfilterable-float', '3d', visibility),
]

/** The bind group entries for those layout entries, over the field's `resources` and the buffer
 *  that holds the view block. */
export const globalReadGroupEntries = (
  first: number,
  view: GPUBufferBinding,
  resources: ReadResources,
): GPUBindGroupEntry[] => [
  { binding: first, resource: view },
  { binding: first + 1, resource: resources.read.createView({ dimension: '3d' }) },
  { binding: first + 2, resource: { buffer: resources.atlas } },
  { binding: first + 3, resource: resources.mip.createView({ dimension: '3d' }) },
]
