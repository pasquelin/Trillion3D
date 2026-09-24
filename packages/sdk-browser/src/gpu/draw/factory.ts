import { DRAW_ITEM_U32, UNIFORM_BYTES, WORKGROUP } from './contract.ts';
import { createGpuDrawBuffers } from './buffers.ts';
import type { GpuDraw } from './contract.ts';
import { validated } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';
import { drawBindEntries, drawShader } from './shader.ts';

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
  const buffers: GPUBuffer[] = [];
  let disposed = false;
  try {
    const allocated = createGpuDrawBuffers(device, slotCap, layerSlots);
    const SLOTS = allocated.slots;
    const { itemsBuf, restBuf, uniforms, instanceBuffer, indirectBuffer } = allocated;
    const { groupCounts, groupOffsets, slotUsedBuf } = allocated;
    buffers.push(...allocated.all);
    const made = await validated(device, async () => {
      const layout = device.createBindGroupLayout({ entries: drawBindEntries() });
      const module = device.createShaderModule({ code: drawShader(layerSlots) });
      if (await shaderFailed(module)) return undefined;
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const stage = (entryPoint: string) =>
        device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
      return {
        layout,
        countPipeline: stage('countGroups'),
        prefixPipeline: stage('prefixGroups'),
        scatterPipeline: stage('scatterGroups'),
      };
    });
    if (!made) {
      for (const buffer of buffers) buffer.destroy();
      return undefined;
    }
    const { layout, countPipeline, prefixPipeline, scatterPipeline } = made;
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
      uploadItems(items, from, to) {
        const last = Math.min(to, slotCap - 1);
        if (disposed || last < from) return;
        device.queue.writeBuffer(
          itemsBuf,
          from * DRAW_ITEM_U32 * 4,
          items.buffer as ArrayBuffer,
          items.byteOffset + from * DRAW_ITEM_U32 * 4,
          (last - from + 1) * DRAW_ITEM_U32 * 4,
        );
      },
      encode(encoder, count, maxVertexCount, selection) {
        if (disposed) return;
        const n = Math.min(count, slotCap);
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
        const pass = encoder.beginComputePass({ label: 'Trillion3D draw compaction' });
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(countPipeline);
        pass.dispatchWorkgroups(Math.ceil((liveGroups * SLOTS) / WORKGROUP));
        pass.setPipeline(prefixPipeline);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(scatterPipeline);
        pass.dispatchWorkgroups(liveGroups);
        pass.end();
      },
      itemsBuffer: itemsBuf,
      restBitsBuffer: restBuf,
      slotUsedBuffer: slotUsedBuf,
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
    for (const buffer of buffers)
      try {
        buffer.destroy();
      } catch {
        /* Partial GPU draw setup must not leak. */
      }
    return undefined;
  }
}
