import { pageTableBuffer } from '../render/pageTable.ts'
import { zeroFlagsBuffer } from '../../visibility/shaders.ts'
import { growShadowRows } from '../../shadow/rowBuffers.ts'
import { pendingAll, pendingBuffers, type PendingGrowth } from '../../../gpu/core/tableGrowth.ts'
import { restSlotCount } from '../../../gpu/draw/contract.ts'
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * EVERY GPU BUFFER SIZED BY ROW, made for `drawSlots` visibility rows and `casterSlots` rows in
 * all (`growTables.ts`): the page table, the zero flags, the draw compact, the Hi-Z verdicts, the
 * partition, the tested half's work buffer at its bound, the spheres and the mobility words.
 * Each only where the session has it, each at the size its next use keeps — nothing is made
 * after the commit —, committed in the order the later ones read the earlier.
 */
export function gpuGrowth(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  drawSlots: number,
  casterSlots: number,
) {
  const { vis, lights } = rt,
    { gpuDraw: draw, gpuHiz: hiz } = vis,
    pageTable = rt.layout.rows.pageTableFloats,
    // The draw compact's entries, `perRow` a visibility row: the tested half's copy and rows.
    compacted = drawSlots * (draw?.perRow ?? 1)
  return pendingAll([
    replaced(vis.zeroFlags && zeroFlagsBuffer(device, drawSlots), (next) => {
      const old = vis.zeroFlags
      vis.zeroFlags = next
      return old
    }),
    replaced(pageTable && pageTableBuffer(device, casterSlots * PAGE_INFO_STRIDE), (next) => {
      const old = vis.pageTable
      vis.pageTable = next
      return old
    }),
    draw?.grow(drawSlots),
    hiz?.growFlags(drawSlots),
    // The draw compact and the Hi-Z test it reads, as they stood: a drop meanwhile throws nothing.
    draw &&
      hiz &&
      vis.gpuPartition?.grow(drawSlots, () => ({
        items: draw.itemsBuffer,
        flags: hiz.flags,
        restBits: draw.restBitsBuffer,
        slotUsed: draw.slotUsedBuffer,
      })),
    vis.gpuRestCompact?.growWork(compacted, restSlotCount(vis.drawLayerSlots), compacted),
    ...growShadowRows(lights, device, casterSlots),
  ])
}

/** `next`, made now, put in place by `adopt`, which returns the buffer it replaced. */
function replaced(
  next: GPUBuffer | undefined,
  adopt: (next: GPUBuffer) => GPUBuffer | undefined,
): PendingGrowth | undefined {
  return next && pendingBuffers([next], () => [adopt(next)])
}
