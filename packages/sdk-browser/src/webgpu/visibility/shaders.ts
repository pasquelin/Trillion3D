import { shaderErrors } from '../../gpu/core/shaderModule.ts';
import { SHADE_UNIFORM_BYTES } from '../../visibility/shader/shaderRequest.ts';
import { SHADE_SHADER, VIS_SHADER } from '../../visibility/buffer.ts';
import { VIS_BINDINGS, atlasLayoutEntries, readOnly } from '../core/bindLayout.ts';
import {
  DIAGNOSTIC_SHADE_WGSL,
  DIAGNOSTIC_VIS_WGSL,
  variesShade,
  variesVisibility,
} from '../../diagnostic/gpuGeometry.ts';
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts';

/** Allocates visibility uniforms and validates both shader modules before pipeline creation. */
export async function createWebgpuVisibilityShaders(
  device: GPUDevice,
  drawSlots: number,
  uniformSlots = 7,
  variant?: DiagnosticGpuVariant,
) {
  const shadeUniform = device.createBuffer({
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const b = VIS_BINDINGS;
  const visBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.cache, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.position, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      {
        binding: b.pageTable,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: readOnly,
      },
      { binding: b.flags, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      {
        binding: b.uniform,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform', minBindingSize: 96 },
      },
      { binding: b.uv, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      ...atlasLayoutEntries(b.color),
      { binding: b.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: b.instances, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.slotOffsets, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
    ],
  });
  // The untested passes bind zeros at the same row index the tested ones read, so the buffer spans
  // the row table; WebGPU hands back a zeroed buffer and nothing ever writes to this one.
  const zeroFlags = device.createBuffer({
    size: Math.max(4, drawSlots * 4),
    usage: GPUBufferUsage.STORAGE,
  });
  const visUniform = device.createBuffer({
    size: uniformSlots * 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // With no variant, the two modules are exactly those from before: production compiles no
  // diagnostic stage.
  const visModule = device.createShaderModule({
    code: variesVisibility(variant) ? VIS_SHADER + DIAGNOSTIC_VIS_WGSL : VIS_SHADER,
  });
  const shadeModule = device.createShaderModule({
    code: variesShade(variant) ? SHADE_SHADER + DIAGNOSTIC_SHADE_WGSL : SHADE_SHADER,
  });
  if ((await shaderErrors(visModule)).length) throw new Error('VIS_SHADER');
  const shadeErrors = await shaderErrors(shadeModule);
  if (shadeErrors.length)
    throw new Error('SHADE_SHADER: ' + shadeErrors.map((message) => message.message).join(' | '));
  return { shadeUniform, visBindGroupLayout, zeroFlags, visUniform, visModule, shadeModule };
}
