import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { rowLodBuffer } from './rowBuffers.ts'

export type ShadowRowLods = ReturnType<typeof rowLodBuffer>

/**
 * The caster rows' detail, the buffer the virtual shadow maps' raster binds
 * (`../vsm/render/renderPass.ts`), made at the table's caster rows the first time a light casts; a
 * table grown resizes it (`growShadowRows`). Its words are
 * the rows pass's (`../../../placement/rows/rowWordsPass.ts`), which writes every row of a buffer made anew,
 * then the rows written, moved, or whose cut readiness moved (`gpuCutStream.ts` marks them).
 */
export function ensureRowLods(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, layout } = rt
  lights.rowLods ??= rowLodBuffer(device, layout.rows.casterSlots)
}
