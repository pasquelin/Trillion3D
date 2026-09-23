export interface DrawItem {
  pageIndex: number;
  bin: number;
  selectionIndex: number;
  layer?: number;
  triangles?: number;
  rest?: boolean;
}

export interface CaseSample {
  name: string;
  items: DrawItem[];
  mask?: number[];
}

export interface RunContext {
  device: GPUDevice;
  cap: number;
  maxVertexCount: number;
  groups: number;
  selectionOffset: number;
  itemBuffer: GPUBuffer;
  restBits: GPUBuffer;
  drawItemU32: number;
  selection: GPUBuffer;
  uniform: GPUBuffer;
  group: GPUBindGroup;
  pipelines: GPUComputePipeline[];
  views: GPUTextureView[];
  visPipelines: GPURenderPipeline[];
  visGroups: GPUBindGroup[];
  indirect: GPUBuffer;
  instances: GPUBuffer;
  offsets: GPUBuffer;
  instRead: GPUBuffer;
  cmdRead: GPUBuffer;
  offsetRead: GPUBuffer;
  pixelsRead: GPUBuffer;
  target: GPUTexture;
  width: number;
  height: number;
  directPage: number;
}

export interface CaseResult {
  name: string;
  instanceIds: number[];
  commands: number[];
  slotOffsets: number[];
  visiblePages: number[][];
}

export async function runCase(sample: CaseSample, context: RunContext): Promise<CaseResult> {
  const {
    device,
    cap,
    maxVertexCount,
    groups,
    selectionOffset,
    itemBuffer,
    restBits,
    drawItemU32,
    selection,
    uniform,
    group,
    pipelines,
    views,
    visPipelines,
    visGroups,
    indirect,
    instances,
    offsets,
    instRead,
    cmdRead,
    offsetRead,
    pixelsRead,
    target,
    width,
    height,
    directPage,
  } = context;
  const n = Math.min(sample.items.length, cap),
    words = new Uint32Array(n * drawItemU32);
  // `rest` no longer travels in the structure: it is a bit of `restBits`, read by `restAt(i)`.
  const bits = new Uint32Array(Math.max(1, Math.ceil(cap / 32)));
  for (let i = 0; i < n; i++) {
    const item = sample.items[i];
    words[i * drawItemU32] = item.pageIndex;
    words[i * drawItemU32 + 1] = item.bin;
    words[i * drawItemU32 + 2] = item.selectionIndex;
    words[i * drawItemU32 + 3] = item.layer ?? 0;
    words[i * drawItemU32 + 4] = item.triangles ?? 0;
    if (item.rest) bits[i >>> 5] |= 1 << (i & 31);
  }
  if (n) device.queue.writeBuffer(itemBuffer, 0, words);
  device.queue.writeBuffer(restBits, 0, bits);
  if (sample.mask) {
    const mask = new Uint32Array(cap + selectionOffset).fill(1);
    mask.set(sample.mask, selectionOffset);
    device.queue.writeBuffer(selection, 0, mask);
  }
  device.queue.writeBuffer(
    uniform,
    0,
    new Uint32Array([
      sample.items.length,
      maxVertexCount,
      cap,
      groups,
      sample.mask ? 1 : 0,
      selectionOffset,
      0,
      0,
    ]),
  );
  const encoder = device.createCommandEncoder(),
    pass = encoder.beginComputePass();
  pass.setBindGroup(0, group);
  for (let i = 0; i < 3; i++) {
    pass.setPipeline(pipelines[i]);
    pass.dispatchWorkgroups(
      i === 1 ? 1 : i === 0 ? Math.ceil((groups * 6) / 64) : Math.max(1, Math.ceil(n / 64)),
    );
  }
  pass.end();
  // Compute output is consumed in the same submission, without a CPU readback/reorder.
  for (let slot = 0; slot < 7; slot++) {
    const render = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: views[slot],
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    render.setPipeline(visPipelines[slot >= 3 && slot < 6 ? 1 : 0]);
    render.setBindGroup(0, visGroups[slot]);
    if (slot < 6) render.drawIndirect(indirect, slot * 16);
    else render.draw(3, 1, 0, directPage);
    render.end();
  }
  encoder.copyBufferToBuffer(instances, 0, instRead, 0, cap * 4);
  encoder.copyBufferToBuffer(indirect, 0, cmdRead, 0, 96);
  encoder.copyBufferToBuffer(offsets, 0, offsetRead, 0, 24);
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: pixelsRead, bytesPerRow: width * 4, rowsPerImage: height },
    [width, height, 7],
  );
  device.queue.submit([encoder.finish()]);
  await Promise.all(
    [instRead, cmdRead, offsetRead, pixelsRead].map((buffer) => buffer.mapAsync(GPUMapMode.READ)),
  );
  const commands = [...new Uint32Array(cmdRead.getMappedRange().slice(0))],
    slotOffsets = [...new Uint32Array(offsetRead.getMappedRange().slice(0))];
  const instanceCount = commands.reduce((sum, word, i) => sum + (i % 4 === 1 ? word : 0), 0);
  const instanceIds = [...new Uint32Array(instRead.getMappedRange().slice(0, instanceCount * 4))];
  const pixels = new Uint32Array(pixelsRead.getMappedRange()),
    visiblePages: number[][] = [];
  for (let slot = 0; slot < 7; slot++)
    visiblePages.push(
      [...new Set(pixels.subarray(slot * width * height, (slot + 1) * width * height))]
        .filter((id) => id !== 0)
        .map((id) => (id >>> 16) - 1)
        .sort((a, b) => a - b),
    );
  const result = { name: sample.name, instanceIds, commands, slotOffsets, visiblePages };
  for (const buffer of [instRead, cmdRead, offsetRead, pixelsRead]) buffer.unmap();

  return result;
}
