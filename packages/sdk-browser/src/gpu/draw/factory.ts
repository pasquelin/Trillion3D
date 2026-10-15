import { UNIFORM_BYTES, drawBatches } from './contract.ts'
import { createGpuDrawBuffers } from './buffers.ts'
import type { GpuDraw } from './contract.ts'
import { constructGpuResources, validated } from '../core/errorScope.ts'
import { shaderFailed } from '../core/shaderModule.ts'
import { drawBindEntries, drawShader } from './shader.ts'
import {
  drawBindGroup,
  encodeDraw,
  encodeDrawTested,
  growDraw,
  uploadDrawItems,
} from './drawOps.ts'
import type { Draw, DrawKernels } from './drawOps.ts'
import { buildComputeStages } from '../core/computeStages.ts'

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
  if (slotCap < 1) return undefined
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
      testedGroup: undefined,
      testedBound: [],
      device,
      slotCap,
      layerSlots,
      corners,
      perRow,
      held,
      disposed: false,
      boundMask: held.itemsBuf,
      bindGroup: drawBindGroup(device, made.occluders.layout, held, held.itemsBuf),
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

/** Each half's three kernels, under one validation scope. */
function compileDraw(device: GPUDevice, layerSlots: number) {
  return validated(device, async () => {
    const [occluders, tested] = await Promise.all(
      [false, true].map((half) => compileHalf(device, layerSlots, half)),
    )
    return occluders && tested ? { occluders, tested } : undefined
  })
}

/** The kernels of the occluder half, or of the tested one (`drawShader`). */
async function compileHalf(
  device: GPUDevice,
  layerSlots: number,
  tested: boolean,
): Promise<DrawKernels | undefined> {
  const layout = device.createBindGroupLayout({ entries: drawBindEntries(tested) })
  const module = device.createShaderModule({ code: drawShader(layerSlots, tested) })
  if (await shaderFailed(module)) return undefined
  const stages = await buildComputeStages(device, [layout], module, [
    'countGroups',
    'prefixGroups',
    'scatterGroups',
  ])
  return {
    layout,
    count: stages.countGroups,
    prefix: stages.prefixGroups,
    scatter: stages.scatterGroups,
  }
}

/** The compact's face (`GpuDraw`) over `d`; `release` destroys the buffers held. */
function drawApi(d: Draw, release: () => void): GpuDraw {
  return {
    uploadItems: (items, from, to) => uploadDrawItems(d, items, from, to),
    encode: (open, count, selection) => encodeDraw(d, open, count, selection),
    encodeTested: (open, pages, flags) => encodeDrawTested(d, open, pages, flags),
    grow: (rows) => growDraw(d, rows),
    get itemsBuffer() {
      return d.held.itemsBuf
    },
    get restBitsBuffer() {
      return d.held.restBuf
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
