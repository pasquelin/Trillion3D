import {
  slotCount,
  DRAW_ITEM_U32,
  UNIFORM_BYTES,
  WORKGROUP,
  DRAW_INDIRECT_STRIDE,
} from './gpuDrawContract.ts';

/**
 * Les tampons d'une compaction : ils ne dépendent que du nombre de lignes et du nombre de couches
 * coplanaires, jamais de l'image. `slotUsed` part à un partout, si bien qu'un appelant qui ne
 * compte rien paie la compaction complète, exactement comme avant.
 */
export function createGpuDrawBuffers(device: GPUDevice, slotCap: number, layerSlots: number) {
  const slots = slotCount(layerSlots);
  const groupCount = Math.ceil(slotCap / WORKGROUP),
    groupBytes = groupCount * slots * 4;
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const itemsBuf = device.createBuffer({ size: slotCap * DRAW_ITEM_U32 * 4, usage: storage });
  const restBuf = device.createBuffer({
    size: Math.max(4, Math.ceil(slotCap / 32) * 4),
    usage: storage,
  });
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
  const slotUsedBuf = device.createBuffer({ size: slots * 4, usage: storage });
  device.queue.writeBuffer(slotUsedBuf, 0, new Uint32Array(slots).fill(1));
  return {
    slots,
    itemsBuf,
    restBuf,
    uniforms,
    instanceBuffer,
    indirectBuffer,
    groupCounts,
    groupOffsets,
    slotUsedBuf,
    all: [
      itemsBuf,
      restBuf,
      uniforms,
      instanceBuffer,
      indirectBuffer,
      groupCounts,
      groupOffsets,
      slotUsedBuf,
    ],
  };
}
