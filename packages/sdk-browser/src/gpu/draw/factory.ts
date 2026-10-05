import { DRAW_ITEM_U32, UNIFORM_BYTES, WORKGROUP, drawBatches } from './contract.ts';
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts';
import { createGpuDrawBuffers } from './buffers.ts';
import type { GpuDraw } from './contract.ts';
import { constructGpuResources, validated } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';
import { drawBindEntries, drawShader } from './shader.ts';
import { pendingBuffers } from '../core/tableGrowth.ts';
import { vsmWriteChanged } from '../../vsm/writeChanged.ts';

/**
 * Stable GPU compact into one drawIndirect command per slot. `layerSlots` is one plus the deepest
 * coplanar layer the scene carries, so a scene with none asks for one layer's `BASE_SLOTS` and
 * pays nothing more. `maxCorners`, the catalogue's widest page, fixes the instances'
 * batches (`drawBatches`). Missing compute returns undefined so the caller keeps the CPU loop.
 * The row buffers grow in place (`grow`): the pipelines stay, the groups are made again.
 */
export async function createGpuDraw(
  device: GPUDevice,
  slotCap: number,
  layerSlots: number,
  maxCorners: number,
): Promise<GpuDraw | undefined> {
  const { corners, perRow } = drawBatches(maxCorners);
  if (typeof device.createComputePipeline !== 'function' || slotCap < 1) return undefined;
  let disposed = false,
    allocated: ReturnType<typeof createGpuDrawBuffers> | undefined;
  const release = () => {
    for (const buffer of allocated?.all ?? []) buffer.destroy();
  };
  try {
    allocated = constructGpuResources(device, () =>
      createGpuDrawBuffers(device, slotCap, layerSlots, perRow),
    );
    const SLOTS = allocated.slots;
    const made = await validated(device, async () => {
      const layout = device.createBindGroupLayout({ entries: drawBindEntries() });
      const module = device.createShaderModule({ code: drawShader(layerSlots) });
      if (await shaderFailed(module)) return undefined;
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const stages = await buildComputeStages(device, pipelineLayout, module, [
        'countGroups',
        'prefixGroups',
        'scatterGroups',
      ]);
      return {
        layout,
        countPipeline: stages.countGroups,
        prefixPipeline: stages.prefixGroups,
        scatterPipeline: stages.scatterGroups,
      };
    });
    if (!made) {
      release();
      return undefined;
    }
    const { layout, countPipeline, prefixPipeline, scatterPipeline } = made;
    let held = allocated;
    const makeBindGroup = (maskBuffer: GPUBuffer) => {
      const { itemsBuf, uniforms, instanceBuffer, indirectBuffer, groupCounts } = held;
      const { groupOffsets, restBuf, slotUsedBuf } = held;
      const bound = [itemsBuf, uniforms, instanceBuffer, indirectBuffer, groupCounts];
      bound.push(groupOffsets, maskBuffer, restBuf, slotUsedBuf);
      return device.createBindGroup({
        layout,
        entries: bound.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    };
    let boundMask = held.itemsBuf,
      bindGroup = makeBindGroup(boundMask);
    const uniData = new Uint32Array(UNIFORM_BYTES / 4);
    return {
      uploadItems(items, from, to) {
        const last = Math.min(to, slotCap - 1);
        if (disposed || last < from) return;
        device.queue.writeBuffer(
          held.itemsBuf,
          from * DRAW_ITEM_U32 * 4,
          items.buffer as ArrayBuffer,
          items.byteOffset + from * DRAW_ITEM_U32 * 4,
          (last - from + 1) * DRAW_ITEM_U32 * 4,
        );
      },
      encode(open, count, selection) {
        if (disposed) return;
        const n = Math.min(count, slotCap);
        // Only the groups the frame's items reach are counted and prefixed. The groups past them hold zero
        // by construction and nothing reads them, so bounding the serial prefix by the live count is exact.
        const liveGroups = Math.max(1, Math.ceil(n / WORKGROUP));
        uniData[0] = count;
        uniData[1] = corners;
        uniData[2] = slotCap;
        uniData[3] = liveGroups;
        uniData[4] = selection ? 1 : 0;
        uniData[5] = selection?.maskOffset ?? 0;
        uniData[6] = perRow;
        const mask = selection?.maskBuffer ?? held.itemsBuf;
        if (mask !== boundMask) {
          boundMask = mask;
          bindGroup = makeBindGroup(mask);
        }
        // Only the words that changed go up — most images change none; a grown table's new
        // buffer is held as its zeros (`vsmWriteChanged`).
        vsmWriteChanged(device, held.uniforms, uniData, 0, uniData.length);
        const pass = open.pass;
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(countPipeline);
        // One workgroup per group of items: each lane reads its own item once (`countGroups`).
        pass.dispatchWorkgroups(liveGroups);
        pass.setPipeline(prefixPipeline);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(scatterPipeline);
        pass.dispatchWorkgroups(liveGroups);
      },
      grow(rows) {
        const next = constructGpuResources(device, () =>
          createGpuDrawBuffers(device, rows, layerSlots, perRow),
        );
        return pendingBuffers(next.all, () => {
          const old = held;
          held = allocated = next;
          slotCap = rows;
          if (boundMask === old.itemsBuf) boundMask = next.itemsBuf;
          bindGroup = makeBindGroup(boundMask);
          return old.all;
        });
      },
      get itemsBuffer() {
        return held.itemsBuf;
      },
      get restBitsBuffer() {
        return held.restBuf;
      },
      get slotUsedBuffer() {
        return held.slotUsedBuf;
      },
      get indirectBuffer() {
        return held.indirectBuffer;
      },
      get instanceBuffer() {
        return held.instanceBuffer;
      },
      get slotOffsetsBuffer() {
        return held.groupOffsets;
      },
      slots: SLOTS,
      corners,
      perRow,
      dispose() {
        disposed = true;
        release();
      },
    };
  } catch {
    try {
      release();
    } catch {
      /* Partial GPU draw setup must not leak. */
    }
    return undefined;
  }
}
