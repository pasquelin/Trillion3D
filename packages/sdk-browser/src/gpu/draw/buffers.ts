import { WORKGROUP_THREADS } from '../dispatch/grid.ts'
import { slotCount, DRAW_ITEM_U32, UNIFORM_BYTES, DRAW_INDIRECT_STRIDE } from './contract.ts'
import { bitWords, ceilDiv } from '../../../../math/src/scalar/integers.ts'

/**
 * Compact buffers: they depend only on the row count, the coplanar-layer count and the instances a
 * row takes at most, never on the frame. `slotTotals` holds each slot's total between the count
 * and the prefix of a run, zero otherwise, then where the occluder half's instances end.
 */
export function createGpuDrawBuffers(
  device: GPUDevice,
  slotCap: number,
  layerSlots: number,
  perRow: number,
) {
  const slots = slotCount(layerSlots)
  const groupCount = ceilDiv(slotCap, WORKGROUP_THREADS),
    groupBytes = groupCount * slots * 4
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const itemsBuf = device.createBuffer({ size: slotCap * DRAW_ITEM_U32 * 4, usage: storage })
  const restBuf = device.createBuffer({
    size: Math.max(4, bitWords(slotCap) * 4),
    usage: storage,
  })
  const uniforms = device.createBuffer({
    label: 'Trillion3D draw compaction uniform',
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // A row takes up to `perRow` instances, one per batch of its triangles (`drawBatches`).
  const instanceBuffer = device.createBuffer({
    size: slotCap * perRow * 4,
    usage: storage | GPUBufferUsage.COPY_SRC,
  })
  const indirectBuffer = device.createBuffer({
    size: slots * DRAW_INDIRECT_STRIDE,
    usage: GPUBufferUsage.INDIRECT | storage | GPUBufferUsage.COPY_SRC,
  })
  const groupCounts = device.createBuffer({ size: groupBytes, usage: GPUBufferUsage.STORAGE })
  const groupOffsets = device.createBuffer({ size: groupBytes, usage: GPUBufferUsage.STORAGE })
  const slotTotals = device.createBuffer({ size: (slots + 1) * 4, usage: GPUBufferUsage.STORAGE })
  return {
    slots,
    itemsBuf,
    restBuf,
    uniforms,
    instanceBuffer,
    indirectBuffer,
    groupCounts,
    groupOffsets,
    slotTotals,
    all: [
      itemsBuf,
      restBuf,
      uniforms,
      instanceBuffer,
      indirectBuffer,
      groupCounts,
      groupOffsets,
      slotTotals,
    ],
  }
}
