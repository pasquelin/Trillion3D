import {
  clipmapMipResolution,
  clipmapResolution,
  OCCLUSION_CONE_HALF_ANGLE,
  pageTableClipmapResolution,
  GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS as INFLUENCE_VOXELS,
  GLOBAL_DISTANCE_FIELD_TRACE_MAX_STEPS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { standInBuffer, standInTexture } from '../../gpu/core/standIns.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
  COMPUTE,
} from '../../gpu/core/computeBindings.ts'
import { GDF_VIEW, GDF_VIEW_FLAG } from './globalReadWgsl.ts'
import type { GlobalResources } from './globalResources.ts'
import type { ClipmapPlan } from './updateRegions.ts'
import type { Vec3 } from './regionBounds.ts'

/**
 * WHAT A SHADER NEEDS TO FIND A POSITION IN THE GLOBAL DISTANCE FIELD, written from the clipmaps'
 * places (`globalReadWgsl.ts` reads it): for each clipmap its centre carried to the translated world
 * — the camera at the origin — and its half-extent; the position-to-volume coordinate, scroll
 * included; the position-to-mip coordinate, the mip's layers the clipmap owns held to their middle
 * for a bilinear read; then the counts, the texel, the farthest a cone is traced, the mip's divider
 * and the distance at which the pages take over from the mip, the settings of a ray marched through
 * the field (`globalTraceWgsl.ts`), the word the coverage atlas begins at in the atlas's buffer, the translation
 * from the world and the flags (`GDF_VIEW_FLAG`: the page atlas is a texture, the simple coverage). All zero where the field holds no clipmap: the shader then
 * answers as a scene without a distance field does.
 */

/** How the page atlas is kept: a texture or a buffer, and the word of the buffer the coverage atlas begins at. */
export type AtlasLayout = Pick<GlobalResources, 'textured' | 'coverageBase'>

/** Writes the view block's record of the clipmap `plan`, the `k`-th of `count`, for a camera at `origin`. */
function writeClipmapView(
  words: Float32Array,
  at: number,
  plan: ClipmapPlan,
  { k, count, mip, origin }: { k: number; count: number; mip: number; origin: Vec3 },
) {
  const field = GDF_VIEW.at
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
}

/** Writes the view block of `plans` (the clipmaps of the movable cache, all of them) at word `at`
 *  of `words`, for a camera at `origin` (centimetres) and the sky light's `occlusionDistance`, the
 *  page atlas kept as `atlas` says. */
export function writeGdfView(
  words: Float32Array,
  at: number,
  settings: GlobalDistanceFieldSettings,
  plans: readonly ClipmapPlan[],
  origin: Vec3,
  occlusionDistance: number,
  atlas: AtlasLayout,
) {
  const field = GDF_VIEW.at
  words.fill(0, at, at + GDF_VIEW.words)
  if (!plans.length) return
  const ints = new Uint32Array(words.buffer, words.byteOffset + at * 4, GDF_VIEW.words)
  const count = plans.length
  const mip = clipmapMipResolution(settings)
  plans.forEach((plan, k) => writeClipmapView(words, at, plan, { k, count, mip, origin }))
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
  ints[field.traceSteps] = GLOBAL_DISTANCE_FIELD_TRACE_MAX_STEPS
  words[at + field.expandCovered] = settings.globalDistanceFieldCoveredExpandSurfaceScale
  words[at + field.expandNotCovered] = settings.globalDistanceFieldNotCoveredExpandSurfaceScale
  words[at + field.minStepNotCovered] = settings.globalDistanceFieldNotCoveredMinStepScale
  words[at + field.ditherStep] = settings.globalDistanceFieldDitheredTransparencyStepThreshold
  words[at + field.ditherTrace] = settings.globalDistanceFieldDitheredTransparencyTraceThreshold
  origin.forEach((c, a) => (words[at + field.translation + a] = -c))
  ints[field.coverageBase] = atlas.coverageBase
  ints[field.flags] =
    (atlas.textured ? GDF_VIEW_FLAG.atlasTexture : 0) |
    (settings.globalDistanceFieldSimpleCoverageBasedExpand ? GDF_VIEW_FLAG.simpleCoverage : 0)
}

/** What the reads bind of the field's resources: the table they read, the atlas as a buffer (the coverage atlas
 *  with it) and as a texture with its sampler, the coarse mip. */
export type ReadResources = Pick<
  GlobalResources,
  'read' | 'atlas' | 'atlasTexture' | 'atlasSampler' | 'mip'
>

/** What the reads bind while the field has no resources: a table, atlases and a mip of one texel, which a
 *  view block that holds no clipmap never has them read. */
export function createNoGlobalField(device: GPUDevice): ReadResources & { destroy(): void } {
  const table = standInTexture(device, 'Trillion3D no global distance field, table', 'r32uint', {
    dimension: '3d',
  })
  const mip = standInTexture(device, 'Trillion3D no global distance field, mip', 'r32float', {
    dimension: '3d',
  })
  const atlas = standInBuffer(
    device,
    'Trillion3D no global distance field, atlas',
    16,
    GPUBufferUsage.STORAGE,
  )
  const atlasTexture = standInTexture(
    device,
    'Trillion3D no global distance field, atlas texture',
    'r8unorm',
    {
      dimension: '3d',
    },
  )
  const atlasSampler = device.createSampler({
    label: 'Trillion3D no global distance field, sampler',
  })
  const held = [table, mip, atlas, atlasTexture]
  return {
    read: table,
    mip,
    atlas,
    atlasTexture,
    atlasSampler,
    destroy: () => held.forEach((resource) => resource.destroy()),
  }
}

/** What a pass that reads the global field takes from the scene (`DistanceFieldScene`): the bind group entries of the
 *  reads' bindings from `first`, and the generation that says they changed, whereupon its group is made again. */
export interface GlobalFieldRead {
  readEntries(first: number): GPUBindGroupEntry[]
  readonly readGeneration: number
}

/** The reads of a session whose scene has no distance fields at all: a view block that holds no clipmap, the
 *  resources of one texel (`createNoGlobalField`) bound behind it. */
export function createNoFieldRead(device: GPUDevice): GlobalFieldRead & { destroy(): void } {
  const none = createNoGlobalField(device)
  const view = standInBuffer(
    device,
    'Trillion3D no global distance field, view',
    GDF_VIEW.words * 4,
    GPUBufferUsage.UNIFORM,
  )
  return {
    readEntries: (first) => globalReadGroupEntries(first, { buffer: view }, none),
    readGeneration: 0,
    destroy: () => (none.destroy(), view.destroy()),
  }
}

/** The layout entries of the reads' bindings from `first`: the view block, the page table (load), the
 *  atlas as a buffer, the coarse mip (load), the atlas as a texture and its sampler. */
export const globalReadLayoutEntries = (
  first: number,
  visibility = COMPUTE,
): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(first, { minBindingSize: GDF_VIEW.words * 4 }, visibility),
  computeTextureEntry(first + 1, 'uint', '3d', visibility),
  computeBufferEntry(first + 2, 'read-only-storage', visibility),
  computeTextureEntry(first + 3, 'unfilterable-float', '3d', visibility),
  computeTextureEntry(first + 4, 'float', '3d', visibility),
  computeSamplerEntry(first + 5, 'filtering', visibility),
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
  { binding: first + 4, resource: resources.atlasTexture.createView({ dimension: '3d' }) },
  { binding: first + 5, resource: resources.atlasSampler },
]
