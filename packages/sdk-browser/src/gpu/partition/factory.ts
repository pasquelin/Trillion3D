import { CORNER_VALUES, PARTITION_WORKGROUP, ROW_DATA_U32 } from './contract.ts';
import { partitionClearThreads } from './clearWgsl.ts';
import type { OpenPass } from '../core/lazyComputePass.ts';

import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts';
import {
  createGpuPartitionBuffers,
  createGpuPartitionGroup,
  createGpuPartitionLayout,
  createGpuPartitionRows,
} from './buffers.ts';
import { pendingBuffers } from '../core/tableGrowth.ts';
import { createPartitionUniformWriter, type PartitionFrame } from './uniform.ts';
import { createPartitionCounters } from './counters.ts';
import { PARTITION_SHADER } from './shader.ts';
import { constructGpuResources, validated } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';
import { readGpuBuffer } from '../core/readback.ts';
import type { GpuPartition, KeptFrame, PartitionSources } from './types.ts';

/** The partition's kernels, in the order a frame dispatches them. */
const KERNELS = ['clearRows', 'projectRows', 'classifyRows'] as const;
const CLEAR = 0,
  PROJECT = 1;

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
  const inputs = { ...sources },
    pyramid = sources.pyramid();
  if (typeof device.createComputePipeline !== 'function' || slotCap < 1 || !pyramid)
    return undefined;
  const allocated = constructGpuResources(device, () => createGpuPartitionBuffers(device, slotCap));
  let disposed = false;
  try {
    // The pyramid changes identity on every target resize: the projection's group follows it,
    // remade only then. A fresh pyramid is all zeros — the far plane — and hides nothing.
    const buffers = { ...allocated, ...inputs, pyramid };
    const made = await validated(device, async () => {
      const module = device.createShaderModule({ code: PARTITION_SHADER });
      if (await shaderFailed(module)) return undefined;
      // Each kernel binds its own buffers (`PARTITION_KERNEL_BINDINGS`): a layout and a pipeline
      // each, compiled together.
      const layouts = KERNELS.map((kernel) => createGpuPartitionLayout(device, kernel));
      const pipelines = await Promise.all(
        KERNELS.map((entryPoint, k) =>
          buildComputePipeline(device, {
            layout: device.createPipelineLayout({ bindGroupLayouts: [layouts[k]] }),
            compute: { module, entryPoint },
          }),
        ),
      );
      return { layouts, pipelines };
    });
    if (!made) {
      for (const buffer of allocated.all) buffer.destroy();
      return undefined;
    }
    const { layouts, pipelines } = made;
    /** Each kernel's group on the buffers of the moment, in `KERNELS` order. */
    const regroup = () =>
      KERNELS.map((kernel, k) => createGpuPartitionGroup(device, layouts[k], kernel, buffers));
    let groups = regroup();
    // This frame runs: `beginFrame` found a pyramid.
    let running = false;
    const writeUniform = createPartitionUniformWriter();
    // Runs `[from, to]` of rows rewritten since the last image, flattened in pairs: their held
    // rectangle, verdict and history describe the page — or the place — that left. The next image
    // clears them before projecting, and reads them as never projected, once.
    const forgotten: number[] = [];
    const rowBytes = ROW_DATA_U32 * 4;
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
    let lastFrame: KeptFrame | undefined,
      counting = false;
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
      get corners() {
        return allocated.corners;
      },
      get tested() {
        return allocated.tested;
      },
      state: allocated.state,
      get rowData() {
        return allocated.rowData;
      },
      uniforms: allocated.uniforms,
      grow(rows, next) {
        const grown = constructGpuResources(device, () => createGpuPartitionRows(device, rows));
        return pendingBuffers(grown.all, () => {
          const old = [allocated.corners, allocated.rowData, allocated.tested];
          const all = [...grown.all, allocated.state, allocated.uniforms];
          Object.assign(allocated, grown, { all });
          const read = next();
          Object.assign(inputs, read);
          Object.assign(buffers, grown, read);
          groups = regroup();
          // The new rows hold nothing: every one reads as never projected.
          forgotten.length = 0;
          return old;
        });
      },
      forgetRows(from: number, to: number) {
        if (to >= from) forgotten.push(from, to);
      },
      /** World corners of rows `[from, to]`: one run of the rows the table declared dirty. */
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
      get counting() {
        return counting;
      },
      beginFrame(encoder: GPUCommandEncoder, frame: PartitionFrame) {
        if (disposed) return;
        // Zero flags are a row never projected: the kernel keeps nothing of what they held.
        for (let i = 0; i < forgotten.length; i += 2) {
          const from = forgotten[i],
            to = Math.min(forgotten[i + 1], allocated.rows - 1);
          if (to >= from)
            encoder.clearBuffer(allocated.rowData, from * rowBytes, (to - from + 1) * rowBytes);
        }
        forgotten.length = 0;
        const pyramid = inputs.pyramid();
        // A frame without a pyramid runs no kernel: it counts nothing, and its sample waits.
        running = !!pyramid;
        counting = running && frame.counting;
        if (!pyramid) return;
        const rows = Math.min(frame.rows, allocated.rows);
        writeUniform(device, allocated.uniforms, frame, rows);
        kept.rows = rows;
        kept.width = frame.width;
        kept.height = frame.height;
        kept.near = frame.near;
        kept.view.set(frame.view);
        kept.viewProj.set(frame.viewProj);
        lastFrame = kept;
        if (pyramid !== buffers.pyramid) {
          buffers.pyramid = pyramid;
          groups[PROJECT] = createGpuPartitionGroup(
            device,
            layouts[PROJECT],
            'projectRows',
            buffers,
          );
        }
      },
      encode(open: OpenPass) {
        if (disposed || !running) return;
        // Nothing is held from frame to frame but the history, which lives in `rowData`:
        // counters, rest bits and per-slot counts start from zero, cleared by the pass's first
        // dispatch; then each row is projected, then classified.
        const pass = open.pass,
          rows = kept.rows,
          rowGroups = Math.max(1, Math.ceil(rows / PARTITION_WORKGROUP));
        const clearThreads = partitionClearThreads(rows, inputs.slotUsed.size / 4);
        for (let k = 0; k < KERNELS.length; k++) {
          pass.setPipeline(pipelines[k]);
          pass.setBindGroup(0, groups[k]);
          pass.dispatchWorkgroups(
            k === CLEAR ? Math.ceil(clearThreads / PARTITION_WORKGROUP) : rowGroups,
          );
        }
      },
      encodeCounts(encoder: GPUCommandEncoder, frame: number) {
        if (!disposed && counting) counters.encodeCopy(encoder, allocated.state, frame);
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
    for (const buffer of allocated.all)
      try {
        buffer.destroy();
      } catch {
        /* A partial GPU setup must leak nothing. */
      }
    return undefined;
  }
}
