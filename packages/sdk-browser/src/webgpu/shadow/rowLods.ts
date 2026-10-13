import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { ROW_LOD_FLOATS } from './rowLodWords.ts'
import { rowBufferBytes } from './rowBuffers.ts'

/** One row's detail words per row of `casterSlots` rows. */
const rowLodBuffer = (device: GPUDevice, casterSlots: number) => ({
  buffer: device.createBuffer({
    label: 'Trillion3D shadow row detail v1',
    size: rowBufferBytes(casterSlots, ROW_LOD_FLOATS),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  }),
  rows: casterSlots,
})

export type ShadowRowLods = ReturnType<typeof rowLodBuffer>

/**
 * The caster rows' detail, the buffer the virtual shadow maps' raster binds
 * (`../../vsm/renderPass.ts`), made at the table's caster rows while a light casts. Its words are
 * the rows pass's (`../../placement/rowWordsPass.ts`), which writes every row of a buffer made anew,
 * then the rows written, moved, or whose cut readiness moved (`gpuCutStream.ts` marks them).
 */
export function ensureRowLods(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, layout } = rt,
    { casterSlots } = layout.rows
  if (lights.rowLods && lights.rowLods.rows === casterSlots) return
  lights.rowLods?.buffer.destroy()
  lights.rowLods = rowLodBuffer(device, casterSlots)
}
