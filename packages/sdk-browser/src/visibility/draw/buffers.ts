import {
  slotCount,
  drawGroupWords,
  drawIndirectBytes,
  DRAW_ITEM_U32,
  UNIFORM_BYTES,
} from './contract.ts'

/**
 * Compact buffers: they depend only on the row count, the coplanar-layer count and the instances a
 * row takes at most, never on the frame. `groups` holds the groups' offsets and their counts in
 * one storage buffer (`drawGroupWords`), `groupEntries` words a region; `indirect` the commands,
 * then the slots' totals (`drawIndirectBytes`).
 */
export function createGpuDrawBuffers(
  device: GPUDevice,
  slotCap: number,
  layerSlots: number,
  perRow: number,
) {
  const slots = slotCount(layerSlots)
  const { entries: groupEntries, words: groupWords } = drawGroupWords(slotCap, slots)
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const itemsBuf = device.createBuffer({ size: slotCap * DRAW_ITEM_U32 * 4, usage: storage })
  // One uniform a half: the same words but the mask each selects by (`selectionOffset`).
  const uniform = (label: string) =>
    device.createBuffer({
      label,
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  const uniforms = uniform('Trillion3D draw compaction uniform'),
    postUniforms = uniform('Trillion3D post draw compaction uniform')
  // A row takes up to `perRow` instances, one per batch of its triangles (`drawBatches`).
  const instanceBuffer = device.createBuffer({
    size: slotCap * perRow * 4,
    usage: storage | GPUBufferUsage.COPY_SRC,
  })
  const indirectBuffer = device.createBuffer({
    size: drawIndirectBytes(slots),
    usage: GPUBufferUsage.INDIRECT | storage | GPUBufferUsage.COPY_SRC,
  })
  const groups = device.createBuffer({ size: groupWords * 4, usage: GPUBufferUsage.STORAGE })
  return {
    slots,
    groupEntries,
    itemsBuf,
    uniforms,
    postUniforms,
    instanceBuffer,
    indirectBuffer,
    groups,
    all: [itemsBuf, uniforms, postUniforms, instanceBuffer, indirectBuffer, groups],
  }
}
