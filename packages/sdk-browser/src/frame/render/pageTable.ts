/** The GPU table of decoded clusters of `bytes` bytes: the records every pass binds whole
 *  (`WebgpuVisState.pageTable`, `./visibleTables.ts`). */
export const pageTableBuffer = (device: GPUDevice, bytes: number) =>
  device.createBuffer({
    label: 'Trillion3D decoded clusters',
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
