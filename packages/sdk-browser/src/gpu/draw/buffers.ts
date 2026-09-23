import {
  slotCount,
  DRAW_ITEM_U32,
  UNIFORM_BYTES,
  WORKGROUP,
  DRAW_INDIRECT_STRIDE,
} from './contract.ts';

/**
 * What one compaction writes: its uniform, its instance list, its indirect commands and its
 * per-group scratch. The camera has one; a light cut has its own, reading the same items.
 */
export function createGpuCompactionBuffers(device: GPUDevice, slotCap: number, slots: number) {
  const groupBytes = Math.ceil(slotCap / WORKGROUP) * slots * 4;
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const uniforms = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const instanceBuffer = device.createBuffer({
    size: slotCap * 4,
    usage: storage | GPUBufferUsage.COPY_SRC,
  });
  const indirectBuffer = device.createBuffer({
    size: slots * DRAW_INDIRECT_STRIDE,
    usage: GPUBufferUsage.INDIRECT | storage | GPUBufferUsage.COPY_SRC,
  });
  const groupCounts = device.createBuffer({ size: groupBytes, usage: GPUBufferUsage.STORAGE });
  const groupOffsets = device.createBuffer({ size: groupBytes, usage: GPUBufferUsage.STORAGE });
  return {
    uniforms,
    instanceBuffer,
    indirectBuffer,
    groupCounts,
    groupOffsets,
    all: [uniforms, instanceBuffer, indirectBuffer, groupCounts, groupOffsets],
  };
}

/**
 * Compact buffers: they depend only on the row count and the coplanar-layer count, never on the
 * frame. `slotUsed` starts as one everywhere, so a caller that counts nothing still pays the full
 * compact, exactly as before.
 */
export function createGpuDrawBuffers(device: GPUDevice, slotCap: number, layerSlots: number) {
  const slots = slotCount(layerSlots);
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const itemsBuf = device.createBuffer({ size: slotCap * DRAW_ITEM_U32 * 4, usage: storage });
  const restBuf = device.createBuffer({
    size: Math.max(4, Math.ceil(slotCap / 32) * 4),
    usage: storage,
  });
  const own = createGpuCompactionBuffers(device, slotCap, slots);
  const slotUsedBuf = device.createBuffer({ size: slots * 4, usage: storage });
  device.queue.writeBuffer(slotUsedBuf, 0, new Uint32Array(slots).fill(1));
  return {
    slots,
    itemsBuf,
    restBuf,
    ...own,
    slotUsedBuf,
    all: [itemsBuf, restBuf, ...own.all, slotUsedBuf],
  };
}
