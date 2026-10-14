import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import type { RecordLayout } from '../../gpu/core/recordLayout.ts'

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

/**
 * The table's texture as the engine lays every record table (`../../gpu/core/recordLayout.ts`): a
 * record's ten texels one field, 256 records a row — 2560 texels, within every device's side, a
 * record's row and column a shift and a mask —, 8192 rows a layer. Grown on the GPU by copy
 * (`hold`), never sent again from the host.
 */
export const MATERIAL_TABLE: RecordLayout = {
  label: 'Trillion3D material records',
  format: 'rgba32uint',
  fields: { Record: MATERIAL_RECORD_TEXELS },
  rowShift: 8,
  layerShift: 13,
}
