import { MATERIAL_RECORD } from './materialLayout.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'

export const F = MATERIAL_RECORD.at
export const lit = () => ({ ...surfaceOf([]), lit: true })
export const layers = () => ({
  mapLayer: new Map<Texture, number>(),
  dataLayer: new Map<Texture, number>(),
})
/** The words the last upload sent, whole: record `r` from word `r · MATERIAL_RECORD_WORDS`. */
export const sentWords = (writes: { data: ArrayBufferView }[]) =>
  new Uint32Array(writes.at(-1)!.data.buffer as ArrayBuffer)
