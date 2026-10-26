import { saturate, clamp } from '../../../../math/src/scalar/reals.ts'
import { PHYSICAL_MAP_FIELDS, type VisMaterial } from '../../visibility/materialType.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import { physicalMapSlot, type MaterialLayers } from '../../geometry/rows/page/pageRowMaterial.ts'
import { channelsOf, copyChanged } from './materialRecord.ts'

/** Words and texels of a lobe extension (`PhysicalInfo`, `materialWgsl.ts`): the four factors, the
 *  coat normal's two scales, the maps' UV channels word and a pad (the graph's law, set per pixel),
 *  the cloth's fuzz colour and amount, the maps' slots in `PHYSICAL_MAP_FIELDS` order and the
 *  specular input (`NO_SPECULAR` where none is declared). */
export const LOBE_RECORD_TEXELS = 5
const LOBE_RECORD_WORDS = LOBE_RECORD_TEXELS * 4

/** One extension, filled before it is compared with the table's: a write allocates nothing. */
const scratch = new Float32Array(LOBE_RECORD_WORDS)
const scratchInts = new Uint32Array(scratch.buffer)
/** The words the cloth's fuzz colour and amount, and the maps' slots, are written at. */
const SHEEN_FACTORS = 8
const MAPS_AT = 12
/** The word of the specular input, after the maps' slots. */
const SPECULAR_AT = MAPS_AT + PHYSICAL_MAP_FIELDS.length
/** What the specular word holds where the surface declares no specular: below any input, which is
 *  never negative, so that the pixel keeps the default (`specularOfFlags`). */
const NO_SPECULAR = -1

/**
 * Writes the lobe extension of `mat` at word `at` (zeros, and no specular, where it `worn`s a graph): its factors as the material declares them,
 * clamped as the lobes read them (a strength and a coat in [0, 1], a coat roughness in
 * [floor, 1], a cloth amount in [0, 1], a specular above 0); the cloth's fuzz colour; its maps' slots in their atlas
 * (the colour atlas for the fuzz colour map, the data atlas for the others), in `PHYSICAL_MAP_FIELDS`
 * order, 0 for none; the texture set map `i` reads in the `MAP_CHANNEL_BITS` bits from
 * `MAP_CHANNEL_BITS * i` of the channels word. Returns whether a word changed.
 */
export function writeLobeRecord(
  ints: Uint32Array,
  at: number,
  mat: VisMaterial,
  layers: MaterialLayers,
  worn = false,
) {
  // A surface that wears a graph takes its lobes from the graph, per pixel, in place of this
  // record's: none of the material's factors or maps is read (`physicalLobes`).
  const own = (value: number) => (worn ? 0 : value)
  scratch.fill(0)
  scratch[0] = own(saturate(mat.anisotropy ?? 0))
  scratch[1] = own(mat.anisotropyRotation ?? 0)
  scratch[2] = own(saturate(mat.clearcoat ?? 0))
  scratch[3] = own(clamp(mat.clearcoatRoughness ?? 0, ROUGHNESS_FLOOR, 1))
  scratch[4] = mat.clearcoatNormalScale?.[0] ?? 1
  scratch[5] = mat.clearcoatNormalScale?.[1] ?? 1
  const fuzz = mat.sheenColor ?? [0, 0, 0]
  for (let c = 0; c < 3; c++) scratch[SHEEN_FACTORS + c] = own(Math.max(fuzz[c], 0))
  scratch[SHEEN_FACTORS + 3] = own(saturate(mat.sheenRoughness ?? 0))
  for (let i = 0; i < PHYSICAL_MAP_FIELDS.length; i++)
    scratchInts[MAPS_AT + i] = worn ? 0 : physicalMapSlot(layers, mat, PHYSICAL_MAP_FIELDS[i])
  scratch[SPECULAR_AT] =
    worn || mat.specularIntensity === undefined ? NO_SPECULAR : Math.max(mat.specularIntensity, 0)
  scratchInts[6] = worn ? 0 : channelsOf(mat, PHYSICAL_MAP_FIELDS)
  return copyChanged(ints, at, scratchInts)
}
