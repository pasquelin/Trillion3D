export function setupVisibility(
  device,
  visModule,
  pageStride,
  makeBuffer,
  instances,
  offsets,
  readUsage,
) {
  const pageCount = 147,
    columns = 16,
    rows = 10,
    width = 256,
    height = 160;
  const table = new Float32Array((pageCount * pageStride) / 4),
    tableInts = new Uint32Array(table.buffer);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const base = (pageIndex * pageStride) / 4;
    table.set(
      [
        0.8 / columns,
        0,
        0,
        0,
        0,
        0.8 / rows,
        0,
        0,
        0,
        0,
        1,
        0,
        (((pageIndex % columns) + 0.5) * 2) / columns - 1,
        1 - ((Math.floor(pageIndex / columns) + 0.5) * 2) / rows,
        0,
        1,
      ],
      base,
    );
    tableInts[base + 25] = 3;
    tableInts[base + 27] = (pageIndex + 1) << 16;
    tableInts[base + 31] = 0xffffffff;
  }
  const pageTable = makeBuffer(table.byteLength),
    indices = makeBuffer(12),
    positions = makeBuffer(36),
    flags = makeBuffer(4),
    uvs = makeBuffer(24);
  device.queue.writeBuffer(pageTable, 0, table);
  device.queue.writeBuffer(indices, 0, new Uint32Array([0, 1, 2]));
  device.queue.writeBuffer(positions, 0, new Float32Array([-1, -1, 0.5, 1, -1, 0.5, 0, 1, 0.5]));
  const maps = device.createTexture({
    size: [1, 1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const mapsView = maps.createView({ dimension: '2d-array' }),
    sampler = device.createSampler();
  const visLayout = device.createBindGroupLayout({
    entries: [
      ...[0, 1, 3, 5, 8, 9].map((binding) => ({
        binding,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      })),
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      {
        binding: 6,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const visPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [visLayout] });
  const visPipelines = ['vis_vs', 'vis_hiz_vs'].map((entryPoint) =>
    device.createRenderPipeline({
      layout: visPipelineLayout,
      vertex: { module: visModule, entryPoint },
      fragment: { module: visModule, entryPoint: 'vis_fs', targets: [{ format: 'r32uint' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
  );
  const visGroups = [];
  for (let slot = 0; slot < 7; slot++) {
    const bytes = new ArrayBuffer(96),
      f32 = new Float32Array(bytes),
      u32 = new Uint32Array(bytes);
    f32.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    u32[20] = slot % 6;
    u32[21] = slot < 6 ? 1 : 0;
    const visUniform = makeBuffer(96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(visUniform, 0, bytes);
    visGroups.push(
      device.createBindGroup({
        layout: visLayout,
        entries: [
          ...[indices, positions, pageTable, flags, visUniform, uvs].map((buffer, binding) => ({
            binding,
            resource: { buffer },
          })),
          { binding: 6, resource: mapsView },
          { binding: 7, resource: sampler },
          { binding: 8, resource: { buffer: instances } },
          { binding: 9, resource: { buffer: offsets } },
        ],
      }),
    );
  }
  const target = device.createTexture({
    size: [width, height, 7],
    format: 'r32uint',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const views = Array.from({ length: 7 }, (_, slot) =>
    target.createView({ dimension: '2d', baseArrayLayer: slot, arrayLayerCount: 1 }),
  );
  const imageBytes = width * height * 4,
    pixelsRead = makeBuffer(imageBytes * 7, readUsage),
    directPage = 122;

  return { width, height, visPipelines, visGroups, views, pixelsRead, directPage, target };
}
