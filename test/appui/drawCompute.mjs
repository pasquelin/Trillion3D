export function setupCompute(device, module, cap, bindEntries, slots, drawItemU32) {
  const groups = Math.ceil(cap / 64),
    usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const makeBuffer = (size, bufferUsage = usage) =>
    device.createBuffer({ size, usage: bufferUsage });
  const itemBuffer = makeBuffer(cap * drawItemU32 * 4),
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
  // `restBits` carries one bit per item — `rest` left the structure for this field — and `slotUsed`
  // starts at one everywhere, like the production buffer: a zero slot compacts nothing.
  const restBits = makeBuffer(Math.max(4, Math.ceil(cap / 32) * 4));
  const slotUsed = makeBuffer(slots * 4);
  device.queue.writeBuffer(slotUsed, 0, new Uint32Array(slots).fill(1));
  // The layout is not copied: it comes from `drawBindEntries()`, under the WGSL.
  const layout = device.createBindGroupLayout({ entries: bindEntries });
  const group = device.createBindGroup({
    layout,
    entries: [
      itemBuffer,
      uniform,
      instances,
      indirect,
      counts,
      offsets,
      selection,
      restBits,
      slotUsed,
    ].map((buffer, binding) => ({ binding, resource: { buffer } })),
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
    restBits,
  };
}
