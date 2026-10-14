import type { PageSurface } from '../../page/surface.ts'
import { FOG_FREE_MODEL_BIT } from '../../scene/surfaceModel.ts'
import { frameNormalScaleY } from '../../visibility/frameNormal.ts'
import { writeSpriteWords } from '../../visibility/shader/spriteWgsl.ts'
import { volumeAttenuation } from '../transparent/volumeLaw.ts'
import { layerSlot, type MaterialLayers } from '../row/pageRowMaterial.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from './materialLayout.ts'

/** The surface a record is written from: its shaded fields and its opacity. */
export type MaterialSurface = Omit<PageSurface, 'version' | 'released'> & { version?: number }

const F = MATERIAL_RECORD.at
/** One record, filled before it is compared with the table's: a write allocates nothing. */
const scratch = new Float32Array(MATERIAL_RECORD_WORDS)
const scratchInts = new Uint32Array(scratch.buffer)
const k = [0, 0, 0]

/** The cutout threshold of `mat` (`MATERIAL_RECORD.cut`). */
const cutOf = (mat: MaterialSurface) =>
  mat.alphaTest > 0 ? mat.alphaTest : mat.dashSize !== undefined ? 0 : 1

/** The factors of `mat` into `scratch`: colours, cut, normal factors, line and sprite rules. */
function factors(mat: MaterialSurface) {
  scratch.set(mat.baseColor, F.baseColor)
  scratch[F.opacity] = mat.opacity
  scratch[F.cut] = cutOf(mat)
  scratch[F.alphaTest] = mat.alphaTest
  scratch[F.metalness] = mat.metalness
  scratch[F.roughness] = mat.roughness
  scratch[F.normalScale] = mat.normalScale
  scratch[F.normalScaleY] = frameNormalScaleY(mat, false)
  scratch[F.tangentNormalScaleY] = frameNormalScaleY(mat, true)
  scratch[F.aoIntensity] = mat.aoIntensity
  scratch[F.dash] = mat.dashSize ?? 0
  scratch[F.dash + 1] = mat.gapSize ?? 0
  writeSpriteWords(scratch, F.sprite, mat.sprite)
  scratch.set(mat.emissive, F.emissive)
  scratch[F.lineWidth] = mat.lineWidth ?? 0
  for (let i = 0; i < 3; i++) scratch[F.subsurface + i] = mat.subsurfaceColor?.[i] ?? 0
  scratchInts[F.model] = (mat.model ?? 0) | (mat.fog === false ? FOG_FREE_MODEL_BIT : 0)
}

/** The volume of `mat` into `scratch`: its share let through, refraction and attenuation. */
function volume(mat: MaterialSurface) {
  const reflectance = (mat.ior - 1) / (mat.ior + 1)
  scratch[F.transmission] = mat.transmission
  scratch[F.invIor] = 1 / Math.max(mat.ior, 1e-3)
  scratch[F.thickness] = mat.thickness
  scratch[F.f0] = reflectance * reflectance
  scratch.set(volumeAttenuation(mat.attenuationColor, mat.attenuationDistance, k), F.attenuation)
  scratchInts[F.pad] = 0
}

/**
 * Writes the record of `mat` at word `at` of `ints`: its factors, its maps' slots in the two
 * atlases (`layers`), `lobes` its lobe extension's word, and its volume. Returns whether a word
 * changed: a surface written again with what it held sends nothing up.
 */
export function writeMaterialRecord(
  ints: Uint32Array,
  at: number,
  mat: MaterialSurface,
  { mapLayer, dataLayer }: MaterialLayers,
  lobes: number,
) {
  factors(mat)
  scratchInts[F.mapIndex] = layerSlot(mapLayer, mat.map)
  scratchInts[F.emissiveIndex] = layerSlot(mapLayer, mat.emissiveMap)
  scratchInts[F.roughnessIndex] = layerSlot(dataLayer, mat.roughnessMap)
  scratchInts[F.metalnessIndex] = layerSlot(dataLayer, mat.metalnessMap)
  scratchInts[F.normalIndex] = layerSlot(dataLayer, mat.normalMap)
  scratchInts[F.aoIndex] = layerSlot(dataLayer, mat.aoMap)
  scratchInts[F.subsurfaceMap] = layerSlot(mapLayer, mat.subsurfaceMap)
  scratchInts[F.lobes] = lobes
  volume(mat)
  return copyChanged(ints, at, scratchInts)
}

/** `from` copied into `ints` at `at`: whether a word changed. */
export function copyChanged(ints: Uint32Array, at: number, from: Uint32Array) {
  let changed = false
  for (let i = 0; i < from.length; i++)
    if (ints[at + i] !== from[i]) {
      ints[at + i] = from[i]
      changed = true
    }
  return changed
}
