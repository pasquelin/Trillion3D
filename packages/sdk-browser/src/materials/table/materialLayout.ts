import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import type { RecordLayout } from '../../gpu/core/recordLayout.ts'

/**
 * THE MATERIAL RECORD: what every pass reads of a surface, once per surface — the page rows, the
 * blend items — transmissive ones read their volume there — name it by rank
 * (`materialTable.ts`) and copy none of it. Its fields in one table: the WGSL struct the passes
 * build from its texels (`materialWgsl.ts`), each field's first word, which the writer below fills,
 * and its words, eleven `rgba32uint` texels.
 *
 * - `cut`, the cutout's threshold a raster tests (`maskKeep`): the alpha test, else zero on a dashed
 *   line, which cuts its gaps alone, else one; `alphaTest` the declared one, which a blend reads (zero for a blended surface: only a masked one is clipped).
 * - `opacity` as declared: a reader of the coverage saturates it, as `surfaceOpacity` does.
 * - Both second normal factors: a pass picks the vertex tangents' one where it reads them
 *   (`frameNormalScaleY`).
 * - `flags`, the bits of `MATERIAL_FLAG`, which the blend's fragments read from the record (`materialFlagOf`). A field of
 *   its own: the model word's thirty-two bits are all taken.
 * - `model`: the surface model, the fog opt-out above it (`FOG_FREE_MODEL_BIT`) and, above that, the
 *   clouds laid over the fog (`CLOUD_FOG_MODEL_BIT`).
 * - The maps' atlas slots, zero for none; `channels`, `MAP_CHANNEL_BITS` bits a map: the texture set map `i` of
 *   `SURFACE_MAP_FIELDS` reads, at bit `MAP_CHANNEL_BITS * i` (glTF's `texCoord`, `channelsOf`); `lobes`, the
 *   first texel of the surface's lobe extension plus one (`writeLobeRecord`), zero without a lobe.
 * - `graph`, the first texel of the values of the graph the surface wears plus one (`graphRecord.ts`),
 *   zero without a graph: the values are the texels from there, at eleven to a record's place.
 * - `irisDistance`, an eye's distance of the iris (`VisMaterial.irisDistance`), read by the resolve of a surface of the eye model
 *   without a graph (`materialModelWgsl.ts`).
 * - The volume: `invIor` the refraction ratio, `attenuation`
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
  ['graph', 'u32'],
  ['attenuation', 'vec3f'],
  ['channels', 'u32'],
  ['irisDistance', 'f32'],
  ['flags', 'u32'],
] as const)
/** The bits of a record's `flags`, a bit each: `fogPerPixel`, the fog is worked out for each pixel
 *  (`VisMaterial.computeFogPerPixel`; always for water); `contactShadows`, the material asks (`asksContact`). */
export const MATERIAL_FLAG = { fogPerPixel: 1, contactShadows: 2 } as const
/** Words and `rgba32uint` texels of one record. */
export const MATERIAL_RECORD_WORDS = MATERIAL_RECORD.words,
  MATERIAL_RECORD_TEXELS = MATERIAL_RECORD_WORDS / 4

/** The bits of the second word of the header texel of a graph's values (`graphRecord.ts`; its first
 *  word is the program's id): the graph wires an `opacityMask` the rasters evaluate, its program is
 *  the transparent pass's, whose ids count from one as the opaque resolve's do, and the graph wires a
 *  `pixelDepthOffset` the visibility rasters evaluate, and the graph wires a `displacement` the
 *  tessellation reads. The one table of them. */
export const GRAPH_HEADER = { mask: 1, blend: 2, depthOffset: 4, displacement: 8 } as const

/**
 * The table's texture as the engine lays every record table (`../../gpu/core/recordLayout.ts`): a
 * record's eleven texels one field, 256 records a row — 2816 texels, within every device's side, a
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
