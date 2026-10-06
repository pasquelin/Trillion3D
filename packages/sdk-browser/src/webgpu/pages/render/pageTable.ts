import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** The GPU page table of `bytes` bytes: the rows every pass binds whole. */
export const pageTableBuffer = (device: GPUDevice, bytes: number) =>
  device.createBuffer({
    label: 'Trillion3D page table',
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

/** The row table spans every row a page can claim — the visibility rows, then the blended
 *  casters' (`../../row/blendCasters.ts`) —, so it is allocated once, and replaced only when the
 *  table grows (`../prepare/growTables.ts`); the layout bounds those rows to one binding of the
 *  device (`../../row/tableRows.ts`). */
export function ensurePageTable(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt,
    { rows } = rt.layout
  if (rows.pageTableFloats) return
  const bytes = Math.max(PAGE_INFO_STRIDE, rows.casterSlots * PAGE_INFO_STRIDE)
  rows.pageTableFloats = new Float32Array(bytes / 4)
  rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer)
  vis.pageTable?.destroy()
  vis.pageTable = pageTableBuffer(device, bytes)
}
