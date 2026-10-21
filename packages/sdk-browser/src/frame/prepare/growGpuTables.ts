import { pageTableBuffer } from '../render/pageTable.ts'
import { zeroRowsBuffer } from '../../visibility/passes/shaders.ts'
import { growShadowRows } from '../../lighting/shadows/casters/rowBuffers.ts'
import { pendingAll, pendingBuffers, type PendingGrowth } from '../../gpu/core/tableGrowth.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/types.ts'
import { budgetRefused, ledgerRoom } from '../../gpu/core/deviceLedger.ts'
import { BUDGET_EXCEEDED, GpuBudgetExceeded } from '../../gpu/core/ledgerBooks.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * EVERY GPU BUFFER SIZED BY ROW, made for `drawSlots` visibility rows and `casterSlots` rows in
 * all (`growTables.ts`): the page table, the zero rows, the draw compact, the spheres and the
 * mobility words.
 * Each only where the session has it, each at the size its next use keeps — nothing is made
 * after the commit —, committed in the order the later ones read the earlier.
 * Made one after another: a throw frees every one made before it. A budget's refusal still asks
 * the rest, each refused one naming its bytes, so the refusal it throws, once all is freed, lacks
 * the room of the whole growth (`refusedWhole`), never of the one buffer that failed.
 */
export function gpuGrowth(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  drawSlots: number,
  casterSlots: number,
) {
  const { vis, lights } = rt,
    draw = vis.gpuDraw,
    pageTable = rt.layout.rows.pageTableFloats
  const steps: (() => PendingGrowth | undefined)[] = [
    () =>
      replaced(device, vis.zeroRows && zeroRowsBuffer(device, drawSlots), (next) => {
        const old = vis.zeroRows
        vis.zeroRows = next
        return old
      }),
    () =>
      replaced(
        device,
        pageTable && pageTableBuffer(device, casterSlots * PAGE_INFO_STRIDE),
        (next) => {
          const old = vis.pageTable
          vis.pageTable = next
          return old
        },
      ),
    () => draw?.grow(drawSlots),
    ...growShadowRows(lights, device, casterSlots),
  ]
  const made: PendingGrowth[] = []
  let lacked = 0,
    refused = false,
    endless = false
  for (const step of steps) {
    try {
      const growth = step()
      if (growth) made.push(growth)
    } catch (error) {
      if (!budgetRefused(error)) {
        pendingAll(made).destroy()
        throw error
      }
      lacked += error.requested
      endless ||= !Number.isFinite(error.shortfall)
      refused = true
    }
  }
  const growth = pendingAll(made)
  if (!refused) return growth
  growth.destroy()
  throw refusedWhole(device, growth.bytes + lacked, endless)
}

/** The budget's refusal of a whole growth of `bytes`, all of it freed: it lacks `bytes` past the
 *  room left, or lacks for good under a limit that is no number (`endless`). */
const refusedWhole = (device: GPUDevice, bytes: number, endless: boolean) =>
  new GpuBudgetExceeded(
    `${BUDGET_EXCEEDED}: requested=${bytes}, label=page tables`,
    endless ? Infinity : Math.max(0, bytes - ledgerRoom(device)),
    bytes,
  )

/** `next`, made now, put in place by `adopt`, which returns the buffer it replaced. */
function replaced(
  device: GPUDevice,
  next: GPUBuffer | undefined,
  adopt: (next: GPUBuffer) => GPUBuffer | undefined,
): PendingGrowth | undefined {
  return next && pendingBuffers(device, [next], () => [adopt(next)])
}
