import { UNIFORM_BYTES, drawBatches } from './contract.ts'
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts'
import { createGpuDrawBuffers } from './buffers.ts'
import type { GpuDraw } from './contract.ts'
import { constructGpuResources, validated } from '../core/errorScope.ts'
import { shaderFailed } from '../core/shaderModule.ts'
import { drawBindEntries, drawShader } from './shader.ts'
import { drawBindGroup, encodeDraw, growDraw, uploadDrawItems, type Draw } from './drawOps.ts'

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
  const { corners, perRow } = drawBatches(maxCorners)
  if (typeof device.createComputePipeline !== 'function' || slotCap < 1) return undefined
  let allocated: ReturnType<typeof createGpuDrawBuffers> | undefined
  let d: Draw | undefined
  const release = () => {
    for (const buffer of (d?.held ?? allocated)?.all ?? []) buffer.destroy()
  }
  try {
    allocated = constructGpuResources(device, () =>
      createGpuDrawBuffers(device, slotCap, layerSlots, perRow),
    )
    const made = await compileDraw(device, layerSlots)
    if (!made) {
      release()
      return undefined
    }
    const held = allocated
    d = {
      ...made,
      device,
      slotCap,
      layerSlots,
      corners,
      perRow,
      held,
      disposed: false,
      boundMask: held.itemsBuf,
      bindGroup: drawBindGroup(device, made.layout, held, held.itemsBuf),
      uniData: new Uint32Array(UNIFORM_BYTES / 4),
    }
    return drawApi(d, release)
  } catch {
    try {
      release()
    } catch {
      /* Partial GPU draw setup must not leak. */
    }
    return undefined
  }
}

/** The compact's three kernels, under one validation scope. */
function compileDraw(device: GPUDevice, layerSlots: number) {
  return validated(device, async () => {
    const layout = device.createBindGroupLayout({ entries: drawBindEntries() })
    const module = device.createShaderModule({ code: drawShader(layerSlots) })
    if (await shaderFailed(module)) return undefined
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
    const stages = await buildComputeStages(device, pipelineLayout, module, [
      'countGroups',
      'prefixGroups',
      'scatterGroups',
    ])
    return {
      layout,
      countPipeline: stages.countGroups,
      prefixPipeline: stages.prefixGroups,
      scatterPipeline: stages.scatterGroups,
    }
  })
}

/** The compact's face (`GpuDraw`) over `d`; `release` destroys the buffers held. */
function drawApi(d: Draw, release: () => void): GpuDraw {
  return {
    uploadItems: (items, from, to) => uploadDrawItems(d, items, from, to),
    encode: (open, count, selection) => encodeDraw(d, open, count, selection),
    grow: (rows) => growDraw(d, rows),
    get itemsBuffer() {
      return d.held.itemsBuf
    },
    get restBitsBuffer() {
      return d.held.restBuf
    },
    get slotUsedBuffer() {
      return d.held.slotUsedBuf
    },
    get indirectBuffer() {
      return d.held.indirectBuffer
    },
    get instanceBuffer() {
      return d.held.instanceBuffer
    },
    get slotOffsetsBuffer() {
      return d.held.groupOffsets
    },
    slots: d.held.slots,
    corners: d.corners,
    perRow: d.perRow,
    dispose() {
      d.disposed = true
      release()
    },
  }
}
