import {
  slotCount,
  DRAW_ITEM_U32,
  UNIFORM_BYTES,
  WORKGROUP,
  DRAW_INDIRECT_STRIDE,
} from './gpuDrawContract.ts';
import type { GpuDraw } from './gpuDrawContract.ts';
import { drawShader } from './gpuDrawShader.ts';

/**
 * Stable GPU compact into one drawIndirect command per slot. `layerSlots` is one plus the deepest
 * coplanar layer the scene carries, so a scene with none asks for the six slots this path has
 * always had and pays nothing. Missing compute returns undefined so the caller keeps the CPU loop.
 */
export async function createGpuDraw(
  device: GPUDevice,
  slotCap: number,
  layerSlots = 1,
): Promise<GpuDraw | undefined> {
  if (typeof device.createComputePipeline !== 'function' || slotCap < 1) return undefined;
  const SLOTS = slotCount(layerSlots);
  const itemBytes = slotCap * DRAW_ITEM_U32 * 4,
    restBytes = Math.max(4, Math.ceil(slotCap / 32) * 4),
    instanceBytes = slotCap * 4,
    indirectBytes = SLOTS * DRAW_INDIRECT_STRIDE,
    groupCount = Math.ceil(slotCap / WORKGROUP),
    groupBytes = groupCount * SLOTS * 4;
  const buffers: GPUBuffer[] = [];
  let disposed = false;
  try {
    const itemsBuf = device.createBuffer({
      size: itemBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const restBuf = device.createBuffer({
      size: restBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const uniforms = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const instanceBuffer = device.createBuffer({
      size: instanceBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const indirectBuffer = device.createBuffer({
      size: indirectBytes,
      usage:
        GPUBufferUsage.INDIRECT |
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    const groupCounts = device.createBuffer({ size: groupBytes, usage: GPUBufferUsage.STORAGE });
    const groupOffsets = device.createBuffer({ size: groupBytes, usage: GPUBufferUsage.STORAGE });
    // Ce que le CPU a compté par slot avant la compaction. Tout à un tant que personne ne le dit :
    // un appelant qui ne fournit rien paie la compaction complète, comme avant.
    const slotUsedBuf = device.createBuffer({
      size: SLOTS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(slotUsedBuf, 0, new Uint32Array(SLOTS).fill(1));
    buffers.push(
      itemsBuf,
      restBuf,
      uniforms,
      instanceBuffer,
      indirectBuffer,
      groupCounts,
      groupOffsets,
      slotUsedBuf,
    );
    if (typeof device.pushErrorScope === 'function') device.pushErrorScope('validation');
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    const module = device.createShaderModule({ code: drawShader(layerSlots) });
    if (typeof module.getCompilationInfo === 'function') {
      const info = await module.getCompilationInfo();
      if (info.messages.some((message) => message.type === 'error')) {
        if (typeof device.popErrorScope === 'function')
          await device.popErrorScope().catch(() => {});
        for (const buffer of buffers) buffer.destroy();
        return undefined;
      }
    }
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const countPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'countGroups' },
    });
    const prefixPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'prefixGroups' },
    });
    const scatterPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'scatterGroups' },
    });
    if (typeof device.popErrorScope === 'function') {
      const error = await device.popErrorScope();
      if (error) {
        for (const buffer of buffers) buffer.destroy();
        return undefined;
      }
    }
    const makeBindGroup = (maskBuffer: GPUBuffer) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: itemsBuf } },
          { binding: 1, resource: { buffer: uniforms } },
          { binding: 2, resource: { buffer: instanceBuffer } },
          { binding: 3, resource: { buffer: indirectBuffer } },
          { binding: 4, resource: { buffer: groupCounts } },
          { binding: 5, resource: { buffer: groupOffsets } },
          { binding: 6, resource: { buffer: maskBuffer } },
          { binding: 7, resource: { buffer: restBuf } },
          { binding: 8, resource: { buffer: slotUsedBuf } },
        ],
      });
    let boundMask = itemsBuf,
      bindGroup = makeBindGroup(boundMask);
    const uniData = new Uint32Array(UNIFORM_BYTES / 4);
    return {
      encode(encoder, items, count, itemsDirty, restBits, maxVertexCount, selection, slotItems) {
        if (disposed) return;
        const n = Math.min(count, slotCap);
        if (slotItems)
          device.queue.writeBuffer(
            slotUsedBuf,
            0,
            slotItems.buffer as ArrayBuffer,
            slotItems.byteOffset,
            SLOTS * 4,
          );
        if (n && itemsDirty)
          device.queue.writeBuffer(
            itemsBuf,
            0,
            items.buffer as ArrayBuffer,
            items.byteOffset,
            n * DRAW_ITEM_U32 * 4,
          );
        if (n)
          device.queue.writeBuffer(
            restBuf,
            0,
            restBits.buffer as ArrayBuffer,
            restBits.byteOffset,
            Math.ceil(n / 32) * 4,
          );
        // Only the groups the frame's items reach are counted and prefixed. The groups past them hold zero
        // by construction and nothing reads them, so bounding the serial prefix by the live count is exact.
        const liveGroups = Math.max(1, Math.ceil(n / WORKGROUP));
        uniData[0] = count;
        uniData[1] = maxVertexCount;
        uniData[2] = slotCap;
        uniData[3] = liveGroups;
        uniData[4] = selection ? 1 : 0;
        uniData[5] = selection?.maskOffset ?? 0;
        const mask = selection?.maskBuffer ?? itemsBuf;
        if (mask !== boundMask) {
          boundMask = mask;
          bindGroup = makeBindGroup(mask);
        }
        device.queue.writeBuffer(uniforms, 0, uniData);
        const pass = encoder.beginComputePass({ label: 'WG draw compaction' });
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(countPipeline);
        pass.dispatchWorkgroups(Math.ceil((liveGroups * SLOTS) / WORKGROUP));
        pass.setPipeline(prefixPipeline);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(scatterPipeline);
        pass.dispatchWorkgroups(liveGroups);
        pass.end();
      },
      indirectBuffer,
      instanceBuffer,
      slotOffsetsBuffer: groupOffsets,
      slots: SLOTS,
      dispose() {
        disposed = true;
        for (const buffer of buffers) buffer.destroy();
      },
    };
  } catch {
    if (typeof device.popErrorScope === 'function') await device.popErrorScope().catch(() => {});
    for (const buffer of buffers)
      try {
        buffer.destroy();
      } catch {
        /* Partial GPU draw setup must not leak. */
      }
    return undefined;
  }
}
