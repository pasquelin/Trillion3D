import type { GpuDraw } from '../../visibility/draw/contract.ts'
import type { GpuHiz } from '../../visibility/hiz/gpu/types.ts'

/** What the partition reads of the draw compact `draw` and the Hi-Z test `hiz` (`PartitionSources`
 *  but the pyramid): at the open, and each time either is made again — grown rows, more coplanar
 *  layers. */
export const partitionSourcesOf = (draw: GpuDraw, hiz: GpuHiz) => ({
  items: draw.itemsBuffer,
  flags: hiz.flags,
  restBits: draw.restBitsBuffer,
  hizLevels: hiz.levelTable,
})
