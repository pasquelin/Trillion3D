import { CORNER_VALUES, ROW_DATA_U32 } from './contract.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { createGpuPartitionBuffers, createGpuPartitionLayout } from './buffers.ts'
import { createPartitionUniformWriter } from './uniform.ts'
import { createPartitionCounters } from './counters.ts'
import { PARTITION_SHADER } from './shader.ts'
import { constructGpuResources, validated } from '../core/errorScope.ts'
import { shaderFailed } from '../core/shaderModule.ts'
import { readGpuBuffer } from '../core/readback.ts'
import type { GpuPartition, PartitionSources } from './types.ts'
import {
  KERNELS,
  beginPartitionFrame,
  encodePartition,
  growPartition,
  regroupPartition,
  type Partition,
} from './partitionFrame.ts'

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
    pyramid = sources.pyramid()
  if (typeof device.createComputePipeline !== 'function' || slotCap < 1 || !pyramid)
    return undefined
  const allocated = constructGpuResources(device, () => createGpuPartitionBuffers(device, slotCap))
  try {
    const made = await compilePartition(device)
    if (!made) {
      for (const buffer of allocated.all) buffer.destroy()
      return undefined
    }
    const p = partitionState(device, made, allocated, inputs, pyramid)
    regroupPartition(p)
    return partitionApi(p)
  } catch {
    for (const buffer of allocated.all)
      try {
        buffer.destroy()
      } catch {
        /* A partial GPU setup must leak nothing. */
      }
    return undefined
  }
}

/** What the partition's methods share, before its first groups. */
function partitionState(
  device: GPUDevice,
  made: Pick<Partition, 'layouts' | 'pipelines'>,
  allocated: Partition['allocated'],
  inputs: PartitionSources,
  pyramid: GPUBuffer,
): Partition {
  // The pyramid changes identity on every target resize: the projection's group follows it,
  // remade only then. A fresh pyramid is all zeros — the far plane — and hides nothing.
  const buffers = { ...allocated, ...inputs, pyramid }
  return {
    ...made,
    device,
    allocated,
    inputs,
    buffers,
    groups: [],
    // This frame runs: `beginFrame` found a pyramid.
    running: false,
    counting: false,
    disposed: false,
    writeUniform: createPartitionUniformWriter(),
    // Runs `[from, to]` of rows rewritten since the last image, flattened in pairs: their held
    // rectangle, verdict and history describe the page — or the place — that left. The next
    // image clears them before projecting, and reads them as never projected, once.
    forgotten: [],
    // What the last frame sent the kernel, kept for the audit: matrices are copied because the
    // camera's are rewritten by the next frame. The copy goes into two arrays allocated once
    // and for all — the audit reads the last frame, never an earlier one.
    kept: {
      rows: 0,
      width: 0,
      height: 0,
      near: 0,
      view: new Float64Array(16),
      viewProj: new Float64Array(16),
    },
    lastFrame: undefined,
    counters: createPartitionCounters(device),
  }
}

/** The partition's kernels, compiled together under one validation scope. */
function compilePartition(device: GPUDevice) {
  return validated(device, async () => {
    const module = device.createShaderModule({ code: PARTITION_SHADER })
    if (await shaderFailed(module)) return undefined
    // Each kernel binds its own buffers (`PARTITION_KERNEL_BINDINGS`): a layout and a pipeline
    // each, compiled together.
    const layouts = KERNELS.map((kernel) => createGpuPartitionLayout(device, kernel))
    const pipelines = await Promise.all(
      KERNELS.map((entryPoint, k) =>
        buildComputePipeline(device, {
          layout: device.createPipelineLayout({ bindGroupLayouts: [layouts[k]] }),
          compute: { module, entryPoint },
        }),
      ),
    )
    return { layouts, pipelines }
  })
}

/** The partition's face (`GpuPartition`) over `p`. */
function partitionApi(p: Partition): GpuPartition {
  const { device, allocated, counters } = p
  const cornerBytes = CORNER_VALUES * 4
  return {
    get lastFrame() {
      return p.lastFrame
    },
    async readRowData(wanted: number) {
      const count = Math.min(wanted, allocated.rows)
      if (p.disposed || count < 1) return undefined
      return readGpuBuffer(device, allocated.rowData, count * ROW_DATA_U32 * 4)
    },
    get corners() {
      return allocated.corners
    },
    get tested() {
      return allocated.tested
    },
    state: allocated.state,
    get rowData() {
      return allocated.rowData
    },
    uniforms: allocated.uniforms,
    grow: (rows, next) => growPartition(p, rows, next),
    forgetRows(from: number, to: number) {
      if (to >= from) p.forgotten.push(from, to)
    },
    /** World corners of rows `[from, to]`: one run of the rows the table declared dirty. */
    uploadCorners(packed: Float32Array, from: number, to: number) {
      if (p.disposed || to < from) return
      const { buffer, byteOffset } = packed
      const at = from * cornerBytes
      const bytes = (to - from + 1) * cornerBytes
      device.queue.writeBuffer(allocated.corners, at, buffer as ArrayBuffer, byteOffset + at, bytes)
    },
    get counting() {
      return p.counting
    },
    beginFrame: (encoder, frame) => beginPartitionFrame(p, encoder, frame),
    encode: (open) => encodePartition(p, open),
    encodeCounts(encoder: GPUCommandEncoder, frame: number) {
      if (!p.disposed && p.counting) counters.encodeCopy(encoder, allocated.state, frame)
    },
    countsDue: (frame: number) => !p.disposed && counters.due(frame),
    countsSubmitted: counters.submitted,
    counts: counters.counts,
    dispose() {
      p.disposed = true
      counters.dispose()
      for (const buffer of allocated.all) buffer.destroy()
    },
  }
}
