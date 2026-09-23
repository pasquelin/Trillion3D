import { CORNER_VALUES, PARTITION_WORKGROUP, ROW_DATA_U32, STATE_WORDS } from './contract.ts';
import {
  createGpuPartitionBuffers,
  createGpuPartitionGroup,
  createGpuPartitionLayout,
} from './buffers.ts';
import {
  createPartitionUniformWriter,
  type ForgottenRows,
  type PartitionFrame,
} from './uniform.ts';
import { createPartitionCounters } from './counters.ts';
import { PARTITION_SHADER } from './shader.ts';
import { dropValidation, openValidation, validationError } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';
import { readGpuBuffer } from '../core/readback.ts';
import type { GpuPartition, KeptFrame, PartitionSources } from './types.ts';

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
  const pyramid = sources.pyramid();
  if (typeof device.createComputePipeline !== 'function' || slotCap < 1 || !pyramid)
    return undefined;
  const allocated = createGpuPartitionBuffers(device, slotCap);
  let disposed = false;
  try {
    openValidation(device);
    const module = device.createShaderModule({ code: PARTITION_SHADER });
    if (await shaderFailed(device, module)) {
      for (const buffer of allocated.all) buffer.destroy();
      return undefined;
    }
    const projectLayout = createGpuPartitionLayout(device, 'projectRows'),
      classifyLayout = createGpuPartitionLayout(device, 'classifyRows');
    const pipelineFor = (layout: GPUBindGroupLayout, entryPoint: string) =>
      device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint },
      });
    const project = pipelineFor(projectLayout, 'projectRows'),
      classify = pipelineFor(classifyLayout, 'classifyRows');
    // The pyramid changes identity on every target resize: the projection's group follows it,
    // remade only then. A fresh pyramid is all zeros — the far plane — and hides nothing.
    const buffers = { ...allocated, ...sources, pyramid };
    let projectGroup = createGpuPartitionGroup(device, projectLayout, 'projectRows', buffers);
    const classifyGroup = createGpuPartitionGroup(device, classifyLayout, 'classifyRows', buffers);
    if (await validationError(device)) {
      for (const buffer of allocated.all) buffer.destroy();
      return undefined;
    }
    const writeUniform = createPartitionUniformWriter();
    // Rows rewritten with another page since the last image: their held rectangle, verdict and
    // history describe the page that left. Read as never projected, once, then forgotten.
    const forget: ForgottenRows = { from: 0, to: -1 };
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
      forgetRows(from: number, to: number) {
        if (to < from) return;
        forget.from = forget.to < forget.from ? from : Math.min(forget.from, from);
        forget.to = Math.max(forget.to, to);
      },
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
        const pyramid = sources.pyramid();
        if (disposed || !pyramid) return;
        const rows = Math.min(frame.rows, allocated.rows);
        // Nothing is held from frame to frame but the history, which lives in `rowData`:
        // counters, rest bits and per-slot counts start from zero.
        encoder.clearBuffer(allocated.state, 0, STATE_WORDS * 4);
        encoder.clearBuffer(sources.restBits);
        encoder.clearBuffer(sources.slotUsed);
        writeUniform(device, allocated.uniforms, frame, rows, forget);
        forget.from = 0;
        forget.to = -1;
        kept.rows = rows;
        kept.width = frame.width;
        kept.height = frame.height;
        kept.near = frame.near;
        kept.view.set(frame.view);
        kept.viewProj.set(frame.viewProj);
        lastFrame = kept;
        if (pyramid !== buffers.pyramid) {
          buffers.pyramid = pyramid;
          projectGroup = createGpuPartitionGroup(device, projectLayout, 'projectRows', buffers);
        }
        const groups = Math.max(1, Math.ceil(rows / PARTITION_WORKGROUP));
        const pass = encoder.beginComputePass({ label: 'Trillion3D partition' });
        pass.setPipeline(project);
        pass.setBindGroup(0, projectGroup);
        pass.dispatchWorkgroups(groups);
        pass.setPipeline(classify);
        pass.setBindGroup(0, classifyGroup);
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
