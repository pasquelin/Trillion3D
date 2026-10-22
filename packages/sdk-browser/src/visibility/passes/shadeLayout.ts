import { SHADE_UNIFORM_BYTES } from '../shader/request.ts'
import { SHADE_BINDINGS, atlasLayoutEntries } from '../../gpu/bind/bindLayout.ts'
import { PHYSICAL_LOBES_FORMAT } from '../../materials/surface/physicalLobes.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { SHADE_OUTPUT_BINDINGS } from '../shader/shadeOutputsWgsl.ts'
import {
  REQUEST_OUTPUT,
  SURFACE_COLOURS_FORMAT,
  SURFACE_WORDS_FORMAT,
} from '../../materials/surface/surfaceOutputs.ts'

/**
 * The material classes' two groups, both seen by their compute stage: the resolve's reads and the
 * lobes target (group 0, `shadeLayout`, which the feedback-free diagnostic pipelines share), then
 * the targets every class stores its pixels in and the bins it reads them from (group 1,
 * `shadeOutputLayout`, `../shader/shadeOutputsWgsl.ts`). Four storage textures a stage — the
 * surfaces' colours and words, each every layer, the feedback target and the lobes —: what every
 * device holds. `shadeLayoutEntries` are group 0's entries: the layout of the classes that draw a
 * displaced pixel adds two (`../tessellation/prismFrame.ts`).
 */
export const shadeLayoutEntries = (): GPUBindGroupLayoutEntry[] => {
  const b = SHADE_BINDINGS
  return [
    computeTextureEntry(b.visView, 'uint'),
    computeBufferEntry(b.cache, 'read-only-storage'),
    computeBufferEntry(b.position, 'read-only-storage'),
    computeBufferEntry(b.uv, 'read-only-storage'),
    // The float pool's normal atlas (`../../gpu/core/floatAtlas.ts`).
    computeTextureEntry(b.normal, 'unfilterable-float', '2d-array'),
    computeBufferEntry(b.pageTable, 'read-only-storage'),
    // The rows' frames the resolve reads (`../shader/shadeCacheWgsl.ts`).
    computeBufferEntry(b.shadeCache, 'read-only-storage'),
    // The surfaces' records — a texture, no storage buffer of the eight —, and the lobes target
    // (`physicalWgsl.ts`).
    computeTextureEntry(b.material, 'uint', '2d-array'),
    computeStorageTextureEntry(b.lobes, PHYSICAL_LOBES_FORMAT),
    ...atlasLayoutEntries(b.color, COMPUTE),
    computeSamplerEntry(b.sampler, 'filtering'),
    computeUniformEntry(b.uniform, { minBindingSize: SHADE_UNIFORM_BYTES }),
    ...atlasLayoutEntries(b.data, COMPUTE),
    // The voxel trace's counters (`voxelStepsWgsl.ts`): only the voxel classes write them.
    computeBufferEntry(b.voxelSteps, 'storage'),
  ]
}

export const shadeLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({ entries: shadeLayoutEntries() })

/** The classes' group 1, made once a device: every set of classes binds the bins' one group. */
export const shadeOutputLayout = oncePerDevice((device) => {
  const b = SHADE_OUTPUT_BINDINGS
  return device.createBindGroupLayout({
    entries: [
      computeStorageTextureEntry(b.colours, SURFACE_COLOURS_FORMAT, 'write-only', '2d-array'),
      computeStorageTextureEntry(b.words, SURFACE_WORDS_FORMAT, 'write-only', '2d-array'),
      computeStorageTextureEntry(b.request, REQUEST_OUTPUT.format),
      computeTextureEntry(b.bins, 'uint', '2d-array'),
      computeTextureEntry(b.bins + 1, 'uint', '2d-array'),
    ],
  })
})
