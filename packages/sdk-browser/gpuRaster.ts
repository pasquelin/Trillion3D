import { DISPATCH_SPAN, LIST_HEADER, rasterSource, RESOLVE } from './gpuSmallTrianglesShader.ts';
import { SMALL_BINDINGS, atlasLayoutEntry, readOnly } from './webgpuBindLayout.ts';
import { smallBindEntries } from './webgpuBindEntries.ts';
import type { WebgpuAtlas } from './webgpuAtlasCommon.ts';
import type { WebgpuAtlasSlots } from './webgpuAtlasSlots.ts';
import { DEPTH_COMPARE } from './depthConvention.ts';

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
  // Un seul tampon de stockage pour l'image et pour la liste : l'étage de calcul n'a droit qu'à huit
  // tampons sur l'appareil le plus pauvre que WebGPU garantit, et le raster les emploie tous.
  const targetBytes = Math.max(8, width * height * 8),
    listOffset = targetBytes;
  const work = device.createBuffer({
    label: 'WG small triangle target and list',
    size: listOffset + Math.max(4, (LIST_HEADER + capacity) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  // The dispatch words are copied out of the list instead of being written through a binding, so no
  // pass ever holds the buffer it dispatches from.
  const indirect = device.createBuffer({
    label: 'WG small triangle dispatch',
    size: 24,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  const b = SMALL_BINDINGS;
  const compute = GPUShaderStage.COMPUTE;
  const computeLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.indices, visibility: compute, buffer: readOnly },
      { binding: b.positions, visibility: compute, buffer: readOnly },
      { binding: b.pages, visibility: compute, buffer: readOnly },
      { binding: b.hizFlags, visibility: compute, buffer: readOnly },
      { binding: b.uniform, visibility: compute, buffer: { type: 'uniform' } },
      { binding: b.uvs, visibility: compute, buffer: readOnly },
      ...b.maps.map((binding) => atlasLayoutEntry(binding, compute)),
      { binding: b.sampler, visibility: compute, sampler: {} },
      { binding: b.work, visibility: compute, buffer: { type: 'storage' } },
      { binding: b.selectionMask, visibility: compute, buffer: readOnly },
      { binding: b.colorSlots, visibility: compute, buffer: readOnly },
    ],
  });
  const resolveLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const computeModule = device.createShaderModule({ code: rasterSource(capacity, listOffset / 4) });
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
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: DEPTH_COMPARE,
      },
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
        colorAtlas: WebgpuAtlas;
        slots: WebgpuAtlasSlots;
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
      const group = (input.groups[input.groupKey] ??= device.createBindGroup({
        layout: computeLayout,
        entries: smallBindEntries({
          indices: input.indices,
          positions: input.positions,
          pages: input.pages,
          hizFlags: input.hizFlags,
          uniform: input.uniform,
          uniformSize: 96,
          uvs: input.uvs,
          colorAtlas: input.colorAtlas,
          sampler: input.sampler,
          work,
          selectionMask: input.selection?.maskBuffer ?? input.hizFlags,
          slots: input.slots,
        }),
      })) as GPUBindGroup;
      encoder.clearBuffer(work, listOffset, 8);
      const rows = Math.max(1, input.pageRows),
        spanY = Math.min(rows, DISPATCH_SPAN),
        spanZ = Math.ceil(rows / DISPATCH_SPAN);
      const binning = encoder.beginComputePass({ label: 'WG small triangle binning' });
      binning.setBindGroup(0, group);
      binning.setPipeline(clear);
      binning.dispatchWorkgroups(Math.ceil((width * height) / 64));
      binning.setPipeline(bin);
      binning.dispatchWorkgroups(Math.max(1, Math.ceil(input.maxTriangles / 64)), spanY, spanZ);
      binning.setPipeline(plan);
      binning.dispatchWorkgroups(1);
      binning.end();
      encoder.copyBufferToBuffer(work, listOffset + 8, indirect, 0, 24);
      // One pass for every raster dispatch: consecutive dispatches already see each other's writes, so
      // both classes have settled the depth winners before either chooses an identifier, and no count
      // reaches the CPU. An identifier chosen before the other class had written its depth would name a
      // triangle that lost.
      const raster = encoder.beginComputePass({ label: 'WG small triangle raster' });
      raster.setBindGroup(0, group);
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
          { binding: 0, resource: { buffer: work, offset: 0, size: targetBytes } },
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
      work.destroy();
      indirect.destroy();
    },
  };
}
export type GpuSmallTriangles = ReturnType<typeof createGpuSmallTriangles>;
