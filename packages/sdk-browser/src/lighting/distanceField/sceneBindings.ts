import {
  COMPUTE,
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import type { AtlasGpu } from './atlasGpu.ts'
import type { ObjectBuffers } from './objectBuffers.ts'

/**
 * THE BINDINGS OF THE MESHES' FIELDS (`meshFieldWgsl`, `MESH_FIELD_BINDINGS` of them from a first one): the
 * scene's block, the bounds and the data of the placements, the meshes' records, the indirection
 * tables, the brick atlas and the sampler it is read through. They name buffers that grow, so a
 * group over them is made again whenever one of them was. The passes of the global field bind them
 * as group 0 alone; a pass that has bindings of its own takes them from a first one on
 * (`sceneLayoutEntries`, `sceneBindEntries`).
 */

/** The layout entries of the bindings from `first`, read by the stages `stage` (the compute stage by default). */
export const sceneLayoutEntries = (first = 0, stage = COMPUTE): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(first, {}, stage),
  computeBufferEntry(first + 1, 'read-only-storage', stage),
  computeBufferEntry(first + 2, 'read-only-storage', stage),
  computeBufferEntry(first + 3, 'read-only-storage', stage),
  computeBufferEntry(first + 4, 'read-only-storage', stage),
  computeTextureEntry(first + 5, 'float', '3d', stage),
  computeSamplerEntry(first + 6, 'filtering', stage),
]

/** The bind group entries over the atlas's resources and the placements' buffers, from `first`. */
export const sceneBindEntries = (
  first: number,
  atlas: AtlasGpu,
  objects: ObjectBuffers,
): GPUBindGroupEntry[] => [
  { binding: first, resource: { buffer: atlas.sceneBuffer } },
  { binding: first + 1, resource: { buffer: objects.bounds } },
  { binding: first + 2, resource: { buffer: objects.data } },
  { binding: first + 3, resource: { buffer: atlas.records.assets } },
  { binding: first + 4, resource: { buffer: atlas.records.table } },
  { binding: first + 5, resource: atlas.brickView },
  { binding: first + 6, resource: atlas.sampler },
]

/** The group over the atlas's resources and the placements' buffers. */
export function sceneBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  atlas: AtlasGpu,
  objects: ObjectBuffers,
) {
  return device.createBindGroup({
    label: 'Trillion3D mesh distance fields',
    layout,
    entries: sceneBindEntries(0, atlas, objects),
  })
}
