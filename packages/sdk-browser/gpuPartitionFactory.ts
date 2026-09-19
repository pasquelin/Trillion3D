import {
  CORNER_VALUES,
  PARTITION_WORKGROUP,
  ROW_DATA_U32,
  STATE_WORDS,
} from './gpuPartitionContract.ts';
import { createGpuPartitionBuffers, createGpuPartitionLayout } from './gpuPartitionBuffers.ts';
import { createPartitionUniformWriter, type PartitionFrame } from './gpuPartitionUniform.ts';
import { createPartitionCounters } from './gpuPartitionCounters.ts';
import { PARTITION_SHADER } from './gpuPartitionShader.ts';
import { dropValidation, openValidation, validationError } from './gpuErrorScope.ts';
import { shaderFailed } from './gpuShaderModule.ts';
import { readGpuBuffer } from './gpuReadback.ts';
import type { GpuPartition, KeptFrame, PartitionSources } from './gpuPartitionTypes.ts';

/**
 * Partition of a frame, done by the GPU: box projection, occluder/tested split, packing of the
 * Hi-Z test bounds. A failed compilation returns `undefined`, and the caller then keeps its cut
 * without occlusion rather than failing silently.
 */
export async function createGpuPartition(
  device: GPUDevice,
  slotCap: number,
  sources: PartitionSources,
): Promise<GpuPartition | undefined> {
  if (typeof device.createComputePipeline !== 'function' || slotCap < 1) return undefined;
  const allocated = createGpuPartitionBuffers(device, slotCap);
  let disposed = false;
  try {
    openValidation(device);
    const layout = createGpuPartitionLayout(device);
    const module = device.createShaderModule({ code: PARTITION_SHADER });
    if (await shaderFailed(device, module)) {
      for (const buffer of allocated.all) buffer.destroy();
      return undefined;
    }
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipelineFor = (entryPoint: string) =>
      device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
    const project = pipelineFor('projectRows'),
      choose = pipelineFor('chooseSplit'),
      classify = pipelineFor('classifyRows');
    const bindGroup = device.createBindGroup({
      layout,
      entries: [
        allocated.corners,
        sources.items,
        sources.flags,
        allocated.rowData,
        allocated.tested,
        sources.restBits,
        sources.slotUsed,
        allocated.state,
        allocated.uniforms,
      ].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    if (await validationError(device)) {
      for (const buffer of allocated.all) buffer.destroy();
      return undefined;
    }
    const writeUniform = createPartitionUniformWriter();
    // What the last frame sent the kernel, kept for the audit: matrices are copied because the
    // camera's are rewritten by the next frame. The copy goes into two arrays allocated once
    // and for all — the audit reads the last frame, never an earlier one.
    const kept: KeptFrame = {
      rows: 0,
      width: 0,
      height: 0,
      near: 0,
      view: new Float64Array(16),
      viewProj: new Float64Array(16),
    };
    let lastFrame: KeptFrame | undefined;
    const counters = createPartitionCounters(device);
    const cornerBytes = CORNER_VALUES * 4;
    return {
      get lastFrame() {
        return lastFrame;
      },
      async readRowData(wanted: number) {
        const count = Math.min(wanted, allocated.rows);
        if (disposed || count < 1) return undefined;
        return readGpuBuffer(device, allocated.rowData, count * ROW_DATA_U32 * 4);
      },
      corners: allocated.corners,
      tested: allocated.tested,
      state: allocated.state,
      rowData: allocated.rowData,
      uniforms: allocated.uniforms,
      /** World corners of rows `[from, to]`, on the table's dirty interval and it alone. */
      uploadCorners(packed: Float32Array, from: number, to: number) {
        if (disposed || to < from) return;
        device.queue.writeBuffer(
          allocated.corners,
          from * cornerBytes,
          packed.buffer as ArrayBuffer,
          packed.byteOffset + from * cornerBytes,
          (to - from + 1) * cornerBytes,
        );
      },
      encode(encoder: GPUCommandEncoder, frame: PartitionFrame) {
        if (disposed) return;
        const rows = Math.min(frame.rows, allocated.rows);
        // Nothing is held from frame to frame but the history, which lives in `rowData`:
        // counters, histogram, rest bits and per-slot counts start from zero.
        encoder.clearBuffer(allocated.state, 0, STATE_WORDS * 4);
        encoder.clearBuffer(sources.restBits);
        encoder.clearBuffer(sources.slotUsed);
        writeUniform(device, allocated.uniforms, frame, rows);
        kept.rows = rows;
        kept.width = frame.width;
        kept.height = frame.height;
        kept.near = frame.near;
        kept.view.set(frame.view);
        kept.viewProj.set(frame.viewProj);
        lastFrame = kept;
        const groups = Math.max(1, Math.ceil(rows / PARTITION_WORKGROUP));
        const pass = encoder.beginComputePass({ label: 'WG partition' });
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(project);
        pass.dispatchWorkgroups(groups);
        pass.setPipeline(choose);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(classify);
        pass.dispatchWorkgroups(groups);
        pass.end();
      },
      encodeCounts(encoder: GPUCommandEncoder, frame: number) {
        if (!disposed) counters.encodeCopy(encoder, allocated.state, frame);
      },
      countsDue: (frame: number) => !disposed && counters.due(frame),
      countsSubmitted: counters.submitted,
      counts: counters.counts,
      dispose() {
        disposed = true;
        counters.dispose();
        for (const buffer of allocated.all) buffer.destroy();
      },
    };
  } catch {
    await dropValidation(device);
    for (const buffer of allocated.all)
      try {
        buffer.destroy();
      } catch {
        /* A partial GPU setup must leak nothing. */
      }
    return undefined;
  }
}
