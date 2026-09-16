import { shaderErrors } from './gpuShaderModule.ts';
import { SHADE_SHADER, VIS_SHADER } from './visibilityBuffer.ts';
import { VIS_BINDINGS, atlasLayoutEntry, readOnly } from './webgpuBindLayout.ts';
import {
  DIAGNOSTIC_SHADE_WGSL,
  DIAGNOSTIC_VIS_WGSL,
  variesShade,
  variesVisibility,
} from './diagnosticGpuGeometry.ts';
import type { DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';

/** Allocates visibility uniforms and validates both shader modules before pipeline creation. */
export async function createWebgpuVisibilityShaders(
  device: GPUDevice,
  drawSlots: number,
  uniformSlots = 7,
  variant?: DiagnosticGpuVariant,
) {
  const shadeUniform = device.createBuffer({
    size: 256,
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
      ...b.maps.map((binding) => atlasLayoutEntry(binding)),
      { binding: b.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: b.instances, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.slotOffsets, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.colorSlots, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
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
  // Sans variante, les deux modules sont exactement ceux d'avant : la production ne compile aucun
  // étage de diagnostic.
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
