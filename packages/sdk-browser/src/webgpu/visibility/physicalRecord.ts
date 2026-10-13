import { saturate, clamp } from '../../../../math/src/scalar/reals.ts'
import { PHYSICAL_MAP_FIELDS, type VisMaterial } from '../../visibility/materialType.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import type { Texture } from '../../../../sdk-core/src/index.ts'

/** Words of one record (`physicalTableWgsl`, `../../visibility/shader/physicalWgsl.ts`): the four
 *  factors, the coat normal's two scales, the maps' UV channels, a pad, the four map slots. */
export const PHYSICAL_RECORD_WORDS = 12

/** One record, filled before it is compared with the table's: a row write allocates nothing. */
const scratch = new Float32Array(PHYSICAL_RECORD_WORDS)
const scratchInts = new Uint32Array(scratch.buffer)

/**
 * Writes the record of `mat` at word `at`: its factors as the material declares them, clamped as
 * the lobes read them (a strength and a coat in [0, 1], a coat roughness in [floor, 1]); its maps'
 * slots in the data atlas, in `PHYSICAL_MAP_FIELDS` order, 0 for none; bit `i` of the channels word
 * set where map `i` reads the second UV set. Returns whether a word changed.
 */
export function writePhysicalRecord(
  ints: Uint32Array,
  at: number,
  mat: VisMaterial,
  dataLayer: ReadonlyMap<Texture, number>,
) {
  scratch[0] = saturate(mat.anisotropy ?? 0)
  scratch[1] = mat.anisotropyRotation ?? 0
  scratch[2] = saturate(mat.clearcoat ?? 0)
  scratch[3] = clamp(mat.clearcoatRoughness ?? 0, ROUGHNESS_FLOOR, 1)
  scratch[4] = mat.clearcoatNormalScale?.[0] ?? 1
  scratch[5] = mat.clearcoatNormalScale?.[1] ?? 1
  let channels = 0
  for (let i = 0; i < PHYSICAL_MAP_FIELDS.length; i++) {
    const map = mat[PHYSICAL_MAP_FIELDS[i]]
    scratchInts[8 + i] = map ? (dataLayer.get(map) ?? 0) : 0
    if (map?.channel === 1) channels |= 1 << i
  }
  scratchInts[6] = channels
  scratchInts[7] = 0
  let changed = false
  for (let i = 0; i < PHYSICAL_RECORD_WORDS; i++)
    if (ints[at + i] !== scratchInts[i]) {
      ints[at + i] = scratchInts[i]
      changed = true
    }
  return changed
}
