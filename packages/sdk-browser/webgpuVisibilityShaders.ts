import { SHADE_SHADER, VIS_SHADER } from './visibilityBuffer.ts';

/** Allocates visibility uniforms and validates both shader modules before pipeline creation. */
export async function createWebgpuVisibilityShaders(
  device: GPUDevice,
  drawSlots: number,
  uniformSlots = 7,
) {
  const shadeUniform = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const visBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      {
        binding: 4,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform', minBindingSize: 96 },
      },
      { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      {
        binding: 6,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 8, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 9, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
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
  const visModule = device.createShaderModule({ code: VIS_SHADER });
  const shadeModule = device.createShaderModule({ code: SHADE_SHADER });
  if (typeof visModule.getCompilationInfo === 'function') {
    const visInfo = await visModule.getCompilationInfo();
    if (visInfo.messages.some((message) => message.type === 'error')) throw new Error('VIS_SHADER');
  }
  if (typeof shadeModule.getCompilationInfo === 'function') {
    const shadeInfo = await shadeModule.getCompilationInfo();
    if (shadeInfo.messages.some((message) => message.type === 'error'))
      throw new Error(
        'SHADE_SHADER: ' +
          shadeInfo.messages
            .filter((message) => message.type === 'error')
            .map((message) => message.message)
            .join(' | '),
      );
  }
  return { shadeUniform, visBindGroupLayout, zeroFlags, visUniform, visModule, shadeModule };
}
