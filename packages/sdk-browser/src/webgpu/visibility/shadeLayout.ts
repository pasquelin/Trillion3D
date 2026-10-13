import { SHADE_UNIFORM_BYTES } from '../../visibility/shader/request.ts'
import { SHADE_BINDINGS, atlasLayoutEntries } from '../core/bindLayout.ts'
import { RECEIVER_TARGET_FORMAT } from '../../visibility/shader/receiverTargetWgsl.ts'
import { PHYSICAL_LOBES_FORMAT } from '../../scene/physicalLobes.ts'
import { SUBSURFACE_FORMAT } from '../../scene/subsurface.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
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
      // The float pool's normal atlas (`../core/floatAtlas.ts`).
      computeTextureEntry(b.normal, 'unfilterable-float', '2d-array', fragment),
      computeBufferEntry(b.pageTable, 'read-only-storage', fragment),
      // The rows' frames the resolve reads (`../../visibility/shader/shadeCacheWgsl.ts`).
      computeBufferEntry(b.shadeCache, 'read-only-storage', fragment),
      // The anisotropic and clear-coat records — a texture, no storage buffer of the eight —, and
      // the lobes target (`physicalWgsl.ts`).
      computeTextureEntry(b.physical, 'uint', '2d', fragment),
      {
        binding: b.lobes,
        visibility: fragment,
        storageTexture: { access: 'write-only', format: PHYSICAL_LOBES_FORMAT },
      },
      ...atlasLayoutEntries(b.color),
      { binding: b.sampler, visibility: fragment, sampler: { type: 'filtering' } },
      {
        binding: b.uniform,
        // The class draws place their tiles in the viewport it holds (`materialTilesWgsl.ts`).
        visibility: fragment | GPUShaderStage.VERTEX,
        buffer: { type: 'uniform', minBindingSize: SHADE_UNIFORM_BYTES },
      },
      ...atlasLayoutEntries(b.data),
    ],
  })
}
