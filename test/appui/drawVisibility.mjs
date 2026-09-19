export function setupVisibility(
  device,
  visModule,
  pageStride,
  makeBuffer,
  instances,
  offsets,
  readUsage,
  visBindings,
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
  // The numbers are not copied: they come from `VIS_BINDINGS` (`webgpuBindLayout.ts`), the source
  // the WGSL already interpolates. One more atlas binding shifts all three sides together —
  // that shift, missed here alone, is what made this proof fail on the page table.
  const b = visBindings;
  const lecture = (binding) => ({
    binding,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: { type: 'read-only-storage' },
  });
  // Une table de pages vide : aucune page ne porte de carte, le pool n'est jamais lu.
  const colorPages = makeBuffer(64 * 4);
  const visLayout = device.createBindGroupLayout({
    entries: [
      lecture(b.cache),
      lecture(b.position),
      lecture(b.pageTable),
      lecture(b.flags),
      lecture(b.uv),
      lecture(b.instances),
      lecture(b.slotOffsets),
      lecture(b.color.pages),
      { binding: b.uniform, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      {
        binding: b.color.pool,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: b.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
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
          { binding: b.cache, resource: { buffer: indices } },
          { binding: b.position, resource: { buffer: positions } },
          { binding: b.pageTable, resource: { buffer: pageTable } },
          { binding: b.flags, resource: { buffer: flags } },
          { binding: b.uniform, resource: { buffer: visUniform } },
          { binding: b.uv, resource: { buffer: uvs } },
          { binding: b.color.pool, resource: mapsView },
          { binding: b.sampler, resource: sampler },
          { binding: b.instances, resource: { buffer: instances } },
          { binding: b.slotOffsets, resource: { buffer: offsets } },
          { binding: b.color.pages, resource: { buffer: colorPages } },
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
