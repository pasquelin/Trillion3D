import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import type { PageSurface } from '../../page/surface.ts'
import { FOG_FREE_MODEL_BIT } from '../../scene/surfaceModel.ts'
import { frameNormalScaleY } from '../../visibility/frameNormal.ts'
import { writeSpriteWords } from '../../visibility/shader/spriteWgsl.ts'
import { volumeAttenuation } from '../transparent/volumeLaw.ts'
import { layerSlot, type MaterialLayers } from '../row/pageRowMaterial.ts'

/**
 * THE MATERIAL RECORD: what every pass reads of a surface, once per surface — the page rows, the
 * blend items, the water's volumes and the shadow's transmittance name it by rank
 * (`materialTable.ts`) and copy none of it. Its fields in one table: the WGSL struct the passes
 * build from its texels (`materialWgsl.ts`), each field's first word, which the writer below fills,
 * and its words, ten `rgba32uint` texels.
 *
 * - `cut`, the cutout's threshold a raster tests (`maskKeep`): the alpha test, else zero on a dashed
 *   line, which cuts its gaps alone, else one; `alphaTest` the declared one, which a blend reads.
 * - `opacity` as declared: a reader of the coverage saturates it, as `surfaceOpacity` does.
 * - Both second normal factors: a pass picks the vertex tangents' one where it reads them
 *   (`frameNormalScaleY`).
 * - `model`: the surface model, the fog opt-out above it (`FOG_FREE_MODEL_BIT`).
 * - The maps' atlas slots, zero for none; `lobes`, the first texel of the surface's lobe extension
 *   plus one (`writeLobeRecord`), zero without a lobe.
 * - The volume: `invIor` the refraction ratio, `f0` Fresnel's at normal incidence, `attenuation`
 *   the law's constant `k` (`volumeAttenuation`), each computed here once in f64.
 */
export const MATERIAL_RECORD = fieldLayout('Material', [
  ['baseColor', 'vec3f'],
  ['opacity', 'f32'],
  ['cut', 'f32'],
  ['alphaTest', 'f32'],
  ['metalness', 'f32'],
  ['roughness', 'f32'],
  ['normalScale', 'f32'],
  ['normalScaleY', 'f32'],
  ['tangentNormalScaleY', 'f32'],
  ['aoIntensity', 'f32'],
  ['dash', 'vec2f'],
  ['sprite', 'vec2f'],
  ['emissive', 'vec3f'],
  ['lineWidth', 'f32'],
  ['subsurface', 'vec3f'],
  ['model', 'u32'],
  ['mapIndex', 'u32'],
  ['emissiveIndex', 'u32'],
  ['roughnessIndex', 'u32'],
  ['metalnessIndex', 'u32'],
  ['normalIndex', 'u32'],
  ['aoIndex', 'u32'],
  ['subsurfaceMap', 'u32'],
  ['lobes', 'u32'],
  ['transmission', 'f32'],
  ['invIor', 'f32'],
  ['thickness', 'f32'],
  ['f0', 'f32'],
  ['attenuation', 'vec3f'],
  ['pad', 'u32'],
] as const)
/** Words and `rgba32uint` texels of one record. */
export const MATERIAL_RECORD_WORDS = MATERIAL_RECORD.words,
  MATERIAL_RECORD_TEXELS = MATERIAL_RECORD_WORDS / 4

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
