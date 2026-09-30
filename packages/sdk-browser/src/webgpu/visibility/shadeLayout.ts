import { SHADE_UNIFORM_BYTES } from '../../visibility/shader/request.ts';
import { SHADE_BINDINGS, atlasLayoutEntries, readOnly } from '../core/bindLayout.ts';
/** The material pass's bind layout, which the feedback-free diagnostic pipelines share. */
export function shadeLayout(device: GPUDevice) {
  const b = SHADE_BINDINGS;
  const fragment = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    entries: [
      {
        binding: b.subsurface,
        visibility: fragment,
        storageTexture: { access: 'write-only', format: 'rgba16float' },
      },
      { binding: b.visView, visibility: fragment, texture: { sampleType: 'uint' } },
      { binding: b.cache, visibility: fragment, buffer: readOnly },
      { binding: b.position, visibility: fragment, buffer: readOnly },
      { binding: b.uv, visibility: fragment, buffer: readOnly },
      // The float pool's normal atlas (`../core/floatAtlas.ts`, #1410).
      {
        binding: b.normal,
        visibility: fragment,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
      },
      { binding: b.pageTable, visibility: fragment, buffer: readOnly },
      ...atlasLayoutEntries(b.color),
      { binding: b.sampler, visibility: fragment, sampler: { type: 'filtering' } },
      {
        binding: b.uniform,
        visibility: fragment,
        buffer: { type: 'uniform', minBindingSize: SHADE_UNIFORM_BYTES },
      },
      ...atlasLayoutEntries(b.data),
    ],
  });
}
