import { DISPATCH_SPAN, LIST_HEADER, rasterSource, RESOLVE } from './gpuSmallTrianglesShader.ts';

/**
 * `capacity` is how many small triangles one image can hold: every triangle of every drawable row, so
 * the list can never overflow and no image ever drops one.
 */
export function createGpuSmallTriangles(
  device: GPUDevice,
  width: number,
  height: number,
  capacity: number,
) {
  const target = device.createBuffer({
    label: 'WG small triangle target',
    size: Math.max(8, width * height * 8),
    usage: GPUBufferUsage.STORAGE,
  });
  const small = device.createBuffer({
    label: 'WG small triangle list',
    size: Math.max(4, (LIST_HEADER + capacity) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  // The dispatch words are copied out of the list instead of being written through a binding, so no
  // pass ever holds the buffer it dispatches from.
  const indirect = device.createBuffer({
    label: 'WG small triangle dispatch',
    size: 24,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  const computeLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      {
        binding: 6,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, sampler: {} },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });
  const resolveLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const computeModule = device.createShaderModule({ code: rasterSource(capacity) });
  const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
  const pipelineFor = (entryPoint: string) =>
    device.createComputePipeline({
      layout: computePipelineLayout,
      compute: { module: computeModule, entryPoint },
    });
  const clear = pipelineFor('clear'),
    bin = pipelineFor('bin'),
    plan = pipelineFor('plan');
  const fineDepth = pipelineFor('fineDepth'),
    fineId = pipelineFor('fineId'),
    coarseDepth = pipelineFor('coarseDepth'),
    coarseId = pipelineFor('coarseId');
  const resolveModule = device.createShaderModule({ code: RESOLVE });
  const resolvePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [resolveLayout] });
  const makeResolve = (two: boolean) =>
    device.createRenderPipeline({
      layout: resolvePipelineLayout,
      vertex: { module: resolveModule, entryPoint: 'vs' },
      fragment: {
        module: resolveModule,
        entryPoint: two ? 'two' : 'one',
        targets: two ? [{ format: 'r32uint' }, { format: 'r32float' }] : [{ format: 'r32uint' }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    });
  const one = makeResolve(false),
    two = makeResolve(true);
  let resolveGroup: GPUBindGroup | undefined;
  return {
    width,
    height,
    capacity,
    encode(
      encoder: GPUCommandEncoder,
      input: {
        indices: GPUBuffer;
        positions: GPUBuffer;
        pages: GPUBuffer;
        hizFlags: GPUBuffer;
        uniform: GPUBuffer;
        uvs: GPUBuffer;
        maps: GPUTextureView;
        sampler: GPUSampler;
        pageRows: number;
        maxTriangles: number;
        idsView: GPUTextureView;
        depthView: GPUTextureView;
        hizView?: GPUTextureView;
        selection?: { maskBuffer: GPUBuffer; maskOffset: number };
        groups: Array<unknown>;
        groupKey: number;
      },
    ) {
      // Every resource here outlives the frame, so the caller keeps the groups and names which one this
      // combination of flag source and selection uses instead of building one per image.
      const compute = (input.groups[input.groupKey] ??= device.createBindGroup({
        layout: computeLayout,
        entries: [
          { binding: 0, resource: { buffer: input.indices } },
          { binding: 1, resource: { buffer: input.positions } },
          { binding: 2, resource: { buffer: input.pages } },
          { binding: 3, resource: { buffer: input.hizFlags } },
          { binding: 4, resource: { buffer: input.uniform, offset: 0, size: 96 } },
          { binding: 5, resource: { buffer: input.uvs } },
          { binding: 6, resource: input.maps },
          { binding: 7, resource: input.sampler },
          { binding: 8, resource: { buffer: target } },
          { binding: 9, resource: { buffer: small } },
          { binding: 10, resource: { buffer: input.selection?.maskBuffer ?? input.hizFlags } },
        ],
      })) as GPUBindGroup;
      encoder.clearBuffer(small, 0, 8);
      const rows = Math.max(1, input.pageRows),
        spanY = Math.min(rows, DISPATCH_SPAN),
        spanZ = Math.ceil(rows / DISPATCH_SPAN);
      const binning = encoder.beginComputePass({ label: 'WG small triangle binning' });
      binning.setBindGroup(0, compute);
      binning.setPipeline(clear);
      binning.dispatchWorkgroups(Math.ceil((width * height) / 64));
      binning.setPipeline(bin);
      binning.dispatchWorkgroups(Math.max(1, Math.ceil(input.maxTriangles / 64)), spanY, spanZ);
      binning.setPipeline(plan);
      binning.dispatchWorkgroups(1);
      binning.end();
      encoder.copyBufferToBuffer(small, 8, indirect, 0, 24);
      // One pass for every raster dispatch: consecutive dispatches already see each other's writes, so
      // both classes have settled the depth winners before either chooses an identifier, and no count
      // reaches the CPU. An identifier chosen before the other class had written its depth would name a
      // triangle that lost.
      const raster = encoder.beginComputePass({ label: 'WG small triangle raster' });
      raster.setBindGroup(0, compute);
      raster.setPipeline(fineDepth);
      raster.dispatchWorkgroupsIndirect(indirect, 0);
      raster.setPipeline(coarseDepth);
      raster.dispatchWorkgroupsIndirect(indirect, 12);
      raster.setPipeline(fineId);
      raster.dispatchWorkgroupsIndirect(indirect, 0);
      raster.setPipeline(coarseId);
      raster.dispatchWorkgroupsIndirect(indirect, 12);
      raster.end();
      resolveGroup ??= device.createBindGroup({
        layout: resolveLayout,
        entries: [
          { binding: 0, resource: { buffer: target } },
          { binding: 1, resource: { buffer: input.uniform, offset: 0, size: 96 } },
        ],
      });
      const resolved = resolveGroup;
      const view = input.hizView;
      const output = encoder.beginRenderPass({
        label: 'WG hybrid visibility resolve',
        colorAttachments: [
          { view: input.idsView, loadOp: 'load', storeOp: 'store' },
          ...(view ? [{ view, loadOp: 'load' as const, storeOp: 'store' as const }] : []),
        ],
        depthStencilAttachment: {
          view: input.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      output.setViewport(0, 0, width, height, 0, 1);
      output.setPipeline(view ? two : one);
      output.setBindGroup(0, resolved);
      output.draw(3);
      output.end();
    },
    dispose() {
      target.destroy();
      small.destroy();
      indirect.destroy();
    },
  };
}
export type GpuSmallTriangles = ReturnType<typeof createGpuSmallTriangles>;
