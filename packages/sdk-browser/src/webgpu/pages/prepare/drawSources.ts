import type { GpuDraw } from '../../../gpu/draw/draw.ts'
import type { GpuHiz } from '../../../gpu/hiz/types.ts'
import type { GpuPartition } from '../../../gpu/partition/types.ts'

/** What the partition reads of the draw compact `draw` and the Hi-Z test `hiz` (`PartitionSources`
 *  but the pyramid): at the open, and each time either is made again — grown rows, more coplanar
 *  layers. */
export const partitionSourcesOf = (draw: GpuDraw, hiz: GpuHiz) => ({
  items: draw.itemsBuffer,
  flags: hiz.flags,
  restBits: draw.restBitsBuffer,
  slotUsed: draw.slotUsedBuffer,
})

/** What the tested half's compaction reads of `draw`, `hiz` and `partition`
 *  (`GpuRestCompact.rebind`): the same occasions. */
export const restSourcesOf = (draw: GpuDraw, hiz: GpuHiz, partition: GpuPartition) => ({
  state: partition.state,
  perRow: draw.perRow,
  instances: draw.instanceBuffer,
  indirect: draw.indirectBuffer,
  slotOffsets: draw.slotOffsetsBuffer,
  flags: hiz.flags,
})
