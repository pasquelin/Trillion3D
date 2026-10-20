import { SHADE_UNIFORM_BYTES } from '../shader/request.ts'
import { SHADE_BINDINGS, atlasLayoutEntries } from '../../gpu/bind/bindLayout.ts'
import { RECEIVER_TARGET_FORMAT } from '../shader/receiverTargetWgsl.ts'
import { PHYSICAL_LOBES_FORMAT } from '../../materials/surface/physicalLobes.ts'
import { SUBSURFACE_FORMAT } from '../../materials/surface/subsurface.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
/** The material pass's bind layout, which the feedback-free diagnostic pipelines share. */
export function shadeLayout(device: GPUDevice) {
  const b = SHADE_BINDINGS
  const fragment = GPUShaderStage.FRAGMENT
  return device.createBindGroupLayout({
    entries: [
      {
        binding: b.subsurface,
        visibility: fragment,
        storageTexture: { access: 'write-only', format: SUBSURFACE_FORMAT },
      },
      {
        binding: b.receiver,
        visibility: fragment,
        storageTexture: { access: 'write-only', format: RECEIVER_TARGET_FORMAT },
      },
      computeTextureEntry(b.visView, 'uint', '2d', fragment),
      computeBufferEntry(b.cache, 'read-only-storage', fragment),
      computeBufferEntry(b.position, 'read-only-storage', fragment),
      computeBufferEntry(b.uv, 'read-only-storage', fragment),
      // The float pool's normal atlas (`../../gpu/core/floatAtlas.ts`).
      computeTextureEntry(b.normal, 'unfilterable-float', '2d-array', fragment),
      computeBufferEntry(b.pageTable, 'read-only-storage', fragment),
      // The rows' frames the resolve reads (`../shader/shadeCacheWgsl.ts`).
      computeBufferEntry(b.shadeCache, 'read-only-storage', fragment),
      // The surfaces' records — a texture, no storage buffer of the eight —, and the lobes target
      // (`physicalWgsl.ts`).
      computeTextureEntry(b.material, 'uint', '2d-array', fragment),
      {
        binding: b.lobes,
        visibility: fragment,
        storageTexture: { access: 'write-only', format: PHYSICAL_LOBES_FORMAT },
      },
      ...atlasLayoutEntries(b.color),
      computeSamplerEntry(b.sampler, 'filtering', fragment),
      // The class draws place their tiles in the viewport it holds (`materialTilesWgsl.ts`).
      computeUniformEntry(
        b.uniform,
        { minBindingSize: SHADE_UNIFORM_BYTES },
        fragment | GPUShaderStage.VERTEX,
      ),
      ...atlasLayoutEntries(b.data),
      // The voxel trace's counters (`voxelStepsWgsl.ts`): only the voxel classes write them.
      computeBufferEntry(b.voxelSteps, 'storage', fragment),
    ],
  })
}
