export function setupCompute(device, module, cap) {
  const groups = Math.ceil(cap / 64),
    usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const makeBuffer = (size, bufferUsage = usage) =>
    device.createBuffer({ size, usage: bufferUsage });
  const itemBuffer = makeBuffer(cap * 16),
    uniform = makeBuffer(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const instances = makeBuffer(cap * 4),
    indirect = makeBuffer(96, usage | GPUBufferUsage.INDIRECT);
  const selectionOffset = 11;
  const counts = makeBuffer(groups * 24),
    offsets = makeBuffer(groups * 24),
    selection = makeBuffer((cap + selectionOffset) * 4);
  const readUsage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
  const instRead = makeBuffer(cap * 4, readUsage),
    cmdRead = makeBuffer(96, readUsage),
    offsetRead = makeBuffer(24, readUsage);
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ...[2, 3, 4, 5].map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      })),
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });
  const group = device.createBindGroup({
    layout,
    entries: [itemBuffer, uniform, instances, indirect, counts, offsets, selection].map(
      (buffer, binding) => ({ binding, resource: { buffer } }),
    ),
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipelines = ['countGroups', 'prefixGroups', 'scatterGroups'].map((entryPoint) =>
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } }),
  );

  return {
    groups,
    makeBuffer,
    itemBuffer,
    uniform,
    instances,
    indirect,
    selectionOffset,
    offsets,
    selection,
    readUsage,
    instRead,
    cmdRead,
    offsetRead,
    group,
    pipelines,
  };
}
