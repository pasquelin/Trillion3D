import { DRAW_ITEM_U32, UNIFORM_BYTES, WORKGROUP } from './contract.ts';
import { createGpuCompactionBuffers, createGpuDrawBuffers } from './buffers.ts';
import type { GpuDraw } from './contract.ts';
import { dropValidation, openValidation, validationError } from '../core/errorScope.ts';
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
    const { itemsBuf, restBuf, instanceBuffer, indirectBuffer } = allocated;
    const { groupOffsets, slotUsedBuf } = allocated;
    buffers.push(...allocated.all);
    openValidation(device);
    const layout = device.createBindGroupLayout({ entries: drawBindEntries() });
    const module = device.createShaderModule({ code: drawShader(layerSlots) });
    if (await shaderFailed(device, module)) {
      for (const buffer of buffers) buffer.destroy();
      return undefined;
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
    if (await validationError(device)) {
      for (const buffer of buffers) buffer.destroy();
      return undefined;
    }
    type Own = ReturnType<typeof createGpuCompactionBuffers>;
    /** One compaction over the shared items, into `own`: the camera's, or a light cut's. */
    const compaction = (own: Own) => {
      const makeBindGroup = (maskBuffer: GPUBuffer) =>
        device.createBindGroup({
          layout,
          entries: [
            itemsBuf,
            own.uniforms,
            own.instanceBuffer,
            own.indirectBuffer,
            own.groupCounts,
            own.groupOffsets,
            maskBuffer,
            restBuf,
            slotUsedBuf,
          ].map((buffer, binding) => ({ binding, resource: { buffer } })),
        });
      let boundMask = itemsBuf,
        bindGroup = makeBindGroup(boundMask);
      const uniData = new Uint32Array(UNIFORM_BYTES / 4);
      return (
        encoder: GPUCommandEncoder,
        count: number,
        maxVertexCount: number,
        selection?: { maskBuffer: GPUBuffer; maskOffset: number },
      ) => {
        // Only the groups the frame's items reach are counted and prefixed. The groups past them
        // hold zero by construction and nothing reads them, so bounding the serial prefix by the
        // live count is exact.
        const liveGroups = Math.max(1, Math.ceil(Math.min(count, slotCap) / WORKGROUP));
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
        device.queue.writeBuffer(own.uniforms, 0, uniData);
        const pass = encoder.beginComputePass({ label: 'WG draw compaction' });
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(countPipeline);
        pass.dispatchWorkgroups(Math.ceil((liveGroups * SLOTS) / WORKGROUP));
        pass.setPipeline(prefixPipeline);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(scatterPipeline);
        pass.dispatchWorkgroups(liveGroups);
        pass.end();
      };
    };
    const compact = compaction(allocated);
    let light: ReturnType<GpuDraw['lightCompaction']> | undefined;
    return {
      encode(encoder, items, count, itemsFrom, itemsTo, maxVertexCount, selection) {
        if (disposed) return;
        // The range the row table just rewrote, and it alone: a frame that sees neither a page
        // arrival nor an eviction sends not one byte of record.
        const last = Math.min(itemsTo, Math.min(count, slotCap) - 1);
        if (last >= itemsFrom)
          device.queue.writeBuffer(
            itemsBuf,
            itemsFrom * DRAW_ITEM_U32 * 4,
            items.buffer as ArrayBuffer,
            items.byteOffset + itemsFrom * DRAW_ITEM_U32 * 4,
            (last - itemsFrom + 1) * DRAW_ITEM_U32 * 4,
          );
        compact(encoder, count, maxVertexCount, selection);
      },
      lightCompaction() {
        if (light) return light;
        const own = createGpuCompactionBuffers(device, slotCap, SLOTS);
        buffers.push(...own.all);
        const encode = compaction(own);
        light = {
          instanceBuffer: own.instanceBuffer,
          indirectBuffer: own.indirectBuffer,
          encode: (encoder, count, maxVertexCount, selection) => {
            if (!disposed) encode(encoder, count, maxVertexCount, selection);
          },
        };
        return light;
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
    await dropValidation(device);
    for (const buffer of buffers)
      try {
        buffer.destroy();
      } catch {
        /* Partial GPU draw setup must not leak. */
      }
    return undefined;
  }
}
