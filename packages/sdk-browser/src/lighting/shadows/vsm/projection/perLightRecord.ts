/**
 * THE PER-LIGHT PATH'S RECORDS (`perLightPass.ts`): one uniform record a shadowed local light, read at a
 * dynamic offset by the projection and the light's draw alike — the pixels the light reaches, its record in
 * the projection's view, its rank in the light buffer and the layer of the mask it writes. The records lie one
 * `perLightStride` apart, the device's offset alignment. The fields are one table: the offsets, the size and
 * the WGSL struct all derive from it.
 */
import { wgslStruct } from '../../../../../../math/src/wgsl/decl.ts'
import { uniformStride } from '../../../../session/memory/pools.ts'

/** The fields of a record, in order: name, words, WGSL type. */
const FIELDS = [
  ['rect', 4, 'vec4i'],
  ['record', 1, 'u32'],
  ['rank', 1, 'u32'],
  ['layer', 1, 'u32'],
] as const

/** Where each field starts in a record, in words: `rect` the pixels the light reaches (x0, y0, x1, y1), `record` its record
 *  in the view, `rank` its rank in the light buffer, `layer` the mask layer it writes. */
export const PER_LIGHT_RECORD_AT = (() => {
  let at = 0
  const where = {} as Record<(typeof FIELDS)[number][0], number>
  for (const [name, words] of FIELDS) {
    where[name] = at
    at += words
  }
  return where
})()

/** Words of a record. */
export const PER_LIGHT_RECORD_WORDS = FIELDS.reduce((sum, [, words]) => sum + words, 0)

/** The record in WGSL. */
export const PER_LIGHT_RECORD_WGSL = wgslStruct(
  'PerLightRecord',
  [],
  `struct PerLightRecord{${FIELDS.map(([name, , type]) => `${name}:${type},`).join('')}}`,
)

/** Bytes of the record a dispatch binds: the struct's size, a multiple of 16. */
export const PER_LIGHT_RECORD_BINDING_BYTES = Math.ceil((PER_LIGHT_RECORD_WORDS * 4) / 16) * 16

/** Bytes a record takes in the buffer: the device's alignment of a dynamic uniform offset
 *  (`uniformStride`). */
export const perLightStride = (device: GPUDevice) => uniformStride(device.limits)

/** The one dynamic offset a light's dispatch or draw binds its record at, written for each light: its groups hold one dynamic buffer. */
const RECORD_OFFSET: number[] = [0]

/** The offset of light `i`'s record among `offsets`, as the one dynamic offset of its group (`RECORD_OFFSET`, rewritten by each call). */
export function recordOffset(offsets: Uint32Array, i: number) {
  RECORD_OFFSET[0] = offsets[i]
  return RECORD_OFFSET
}
