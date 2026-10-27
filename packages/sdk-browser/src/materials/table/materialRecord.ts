import type { SurfaceFacts } from '../../geometry/pages/surface.ts'
import {
  SURFACE_MAP_FIELDS,
  type PHYSICAL_MAP_FIELDS,
  type VisMaterial,
} from '../../visibility/materialType.ts'
import { alphaModeOf } from '../../../../sdk-core/src/contracts/material.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import {
  CLOUD_FOG_MODEL_BIT,
  DITHER_MODEL_BIT,
  FOG_FREE_MODEL_BIT,
  SUBSURFACE_OPACITY_MODEL_SHIFT,
  MASKED_MODEL_BIT,
  NORMAL_CURVATURE_MODEL_BIT,
  SHADING_MODEL_MODEL_SHIFT,
  SUBSURFACE_PROFILE_MODEL_SHIFT,
  TRANSLUCENCY_LIGHTING_MODEL_SHIFT,
  TRANSLUCENT_SHADOW_MARK,
  TRANSLUCENT_SHADOW_MODEL_SHIFT,
  subsurfaceOpacityCode,
} from '../surface/surfaceModelWord.ts'
import { translucencyLightingCode, LIGHTLESS_MODEL } from '../surface/translucencyLighting.ts'
import { shadingModelCode } from '../surface/shadingModelCode.ts'
import { asksContact, blendLightSource } from '../surface/blendLightSource.ts'
import { frameNormalScaleY } from '../../visibility/frameNormal.ts'
import { writeSpriteWords } from '../../visibility/shader/spriteWgsl.ts'
import { volumeAttenuation } from '../../blend/transparent/volumeLaw.ts'
import { layerSlot, type MaterialLayers } from '../../geometry/rows/page/pageRowMaterial.ts'
import { MATERIAL_FLAG, MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from './materialLayout.ts'

/** The surface a record is written from: its shaded fields, its opacity, whether it is blended,
 *  and its version where it has one — none of its release, which a record never reads. */
export type MaterialSurface = VisMaterial &
  Pick<SurfaceFacts, 'opacity' | 'transparent'> & { version?: number }

const F = MATERIAL_RECORD.at
/** One record, filled before it is compared with the table's: a write allocates nothing. */
const scratch = new Float32Array(MATERIAL_RECORD_WORDS)
const scratchInts = new Uint32Array(scratch.buffer)
const k = [0, 0, 0]

/** The values of a surface with no graph (`writeGraphRecord`). */
const NO_GRAPH = { word: 0, channels: 0 }

/** The cutout threshold of `mat` (`MATERIAL_RECORD.cut`). */
const cutOf = (mat: Pick<MaterialSurface, 'alphaTest' | 'dashSize'>) =>
  mat.alphaTest > 0 ? mat.alphaTest : mat.dashSize !== undefined ? 0 : 1

/** What a graph's surface is cut by: no alpha test. */
const NOT_CUT = { alphaTest: 0 } as Pick<MaterialSurface, 'alphaTest' | 'dashSize'>
const ONE: readonly [number, number, number] = [1, 1, 1]

/** The factors of `mat` into `scratch`: colours, cut, normal factors, line and sprite rules. A surface
 *  that wears a graph (`worn`) is the graph: its record holds the factors that change nothing — one,
 *  no cutout, no thin transmission — and no map, so that no pass reads the material's value where
 *  the graph computes it (the raster's cutout, which reads the opacity and the cut, draws it whole);
 *  its `cut` is the clip value of its mask (`clip`, any number, zero and below included) where the
 *  graph wires one. */
function factors(mat: MaterialSurface, worn: boolean, clip: number | undefined) {
  const own = (value: number, neutral: number) => (worn ? neutral : value)
  scratch.set(worn ? ONE : mat.baseColor, F.baseColor)
  scratch[F.opacity] = own(mat.opacity, 1)
  scratch[F.cut] = clip ?? cutOf(worn ? NOT_CUT : mat)
  // A blended surface composes: its coverage test is the cutout's, never the blend stage's.
  scratch[F.alphaTest] = own(mat.transparent ? 0 : mat.alphaTest, 0)
  scratch[F.metalness] = own(mat.metalness, 1)
  scratch[F.roughness] = own(mat.roughness, 1)
  scratch[F.normalScale] = own(mat.normalScale, 1)
  scratch[F.normalScaleY] = own(frameNormalScaleY(mat, false), 1)
  scratch[F.tangentNormalScaleY] = own(frameNormalScaleY(mat, true), 1)
  scratch[F.aoIntensity] = own(mat.aoIntensity, 1)
  scratch[F.dash] = mat.dashSize ?? 0
  scratch[F.dash + 1] = mat.gapSize ?? 0
  writeSpriteWords(scratch, F.sprite, mat.sprite)
  scratch.set(worn ? ONE : mat.emissive, F.emissive)
  scratch[F.lineWidth] = mat.lineWidth ?? 0
  scratch[F.irisDistance] = mat.irisDistance ?? 0
  scratchInts[F.flags] =
    (mat.computeFogPerPixel === true || mat.water === true ? MATERIAL_FLAG.fogPerPixel : 0) |
    (asksContact(mat) ? MATERIAL_FLAG.contactShadows : 0)
  for (let i = 0; i < 3; i++) scratch[F.subsurface + i] = worn ? 0 : (mat.subsurfaceColor?.[i] ?? 0)
  scratchInts[F.model] = modelWord(mat)
}

/** The model word of `mat`: its shading model, and the bits and codes of its fog, cutout, translucency and
 *  subsurface rules. */
const modelWord = (mat: MaterialSurface) =>
  laneModelOf(mat) |
  (mat.fog === false ? FOG_FREE_MODEL_BIT : 0) |
  (mat.cloudFog && mat.fog !== false ? CLOUD_FOG_MODEL_BIT : 0) |
  (mat.ditherOpacityMask === true ? DITHER_MODEL_BIT : 0) |
  (mat.normalCurvatureToRoughness === true ? NORMAL_CURVATURE_MODEL_BIT : 0) |
  (alphaModeOf(mat) === 'mask' ? MASKED_MODEL_BIT : 0) |
  (translucentShadowMarks(mat) << TRANSLUCENT_SHADOW_MODEL_SHIFT) |
  (translucencyLightingCode(mat.translucencyLighting) << TRANSLUCENCY_LIGHTING_MODEL_SHIFT) |
  (subsurfaceOpacityCode(mat.subsurfaceOpacity ?? 1) << SUBSURFACE_OPACITY_MODEL_SHIFT) |
  ((mat.subsurfaceProfile ?? 0) << SUBSURFACE_PROFILE_MODEL_SHIFT) |
  ((shadingModelCode(mat.shadingModel) << SHADING_MODEL_MODEL_SHIFT) >>> 0)

/** The model lane of `mat`: its surface model, or the rank of a surface no light reaches (`LIGHTLESS_MODEL`) where a standard one is
 *  lit by nothing in its lighting mode (`blendLightSource`: `none`). */
const laneModelOf = (mat: MaterialSurface) => {
  const model = mat.model ?? 0
  return model === 0 &&
    blendLightSource(mat.translucencyLighting, 'normal', mat.shadingModel, model, true, false) ===
      'none'
    ? LIGHTLESS_MODEL
    : model
}

/** How `mat` reads the shadow of the lights that reach it, as the three marks of
 *  `TRANSLUCENT_SHADOW_MARK`: a trace is asked by a quality above 0. */
const translucentShadowMarks = (mat: MaterialSurface) =>
  (mat.translucentLocalLightShadow ? TRANSLUCENT_SHADOW_MARK.local : 0) |
  ((mat.translucentLocalLightShadowQuality ?? 0) > 0 ? TRANSLUCENT_SHADOW_MARK.localTrace : 0) |
  ((mat.translucentDirectionalLightShadowQuality ?? 0) > 0
    ? TRANSLUCENT_SHADOW_MARK.directionalTrace
    : 0)

/**
 * The volume of `mat` into the record: its share let through, its refraction ratio `1 / ior` — one
 * where it declares no ior (`refracts`): it bends nothing —, its thickness and the law's constant
 * `k` (`volumeAttenuation`), each computed here once in f64 — the record's (`transmission` to
 * `attenuation`), which a transmissive layer reads (`../../blend/transmission/transmitWgsl.ts`).
 */
function writeVolumeTerms(out: Float32Array, mat: MaterialSurface) {
  out[F.transmission] = mat.transmission
  out[F.invIor] = mat.refracts ? 1 / Math.max(mat.ior, 1e-3) : 1
  out[F.thickness] = mat.thickness
  out.set(volumeAttenuation(mat.attenuationColor, mat.attenuationDistance, k), F.attenuation)
}

/**
 * Writes the record of `mat` at word `at` of `ints`: its factors, its maps' slots in the two
 * atlases (`layers`), `lobes` its lobe extension's word, `graph` the word of its graph's values
 * (`graphRecord.ts`: its word and the channels word it reads in place of its maps'), and its volume. Returns whether a word changed: a surface written again
 * with what it held sends nothing up.
 */
export function writeMaterialRecord(
  ints: Uint32Array,
  at: number,
  mat: MaterialSurface,
  { mapLayer, dataLayer }: MaterialLayers,
  lobes: number,
  graph: { word: number; channels: number; clip?: number | undefined } = NO_GRAPH,
) {
  const worn = graph.word !== 0
  factors(mat, worn, graph.clip)
  // A surface that wears a graph reads no map of its own (`wearGraph`).
  const slot = (layers: ReadonlyMap<Texture, number>, texture: Texture | undefined) =>
    worn ? 0 : layerSlot(layers, texture)
  scratchInts[F.mapIndex] = slot(mapLayer, mat.map)
  scratchInts[F.emissiveIndex] = slot(mapLayer, mat.emissiveMap)
  scratchInts[F.roughnessIndex] = slot(dataLayer, mat.roughnessMap)
  scratchInts[F.metalnessIndex] = slot(dataLayer, mat.metalnessMap)
  scratchInts[F.normalIndex] = slot(dataLayer, mat.normalMap)
  scratchInts[F.aoIndex] = slot(dataLayer, mat.aoMap)
  scratchInts[F.subsurfaceMap] = slot(mapLayer, mat.subsurfaceMap)
  scratchInts[F.lobes] = lobes
  scratchInts[F.graph] = graph.word
  writeVolumeTerms(scratch, mat)
  scratchInts[F.channels] = graph.word ? graph.channels : channelsOf(mat, SURFACE_MAP_FIELDS)
  return copyChanged(ints, at, scratchInts)
}

/** Bits a map takes in a UV channels word: the texture set it reads, of the `MAX_UV_SETS` a page carries. */
export const MAP_CHANNEL_BITS = 3

/** The UV channels word of `mat`'s maps `fields`: `MAP_CHANNEL_BITS` a map, map `i`'s at bit
 *  `MAP_CHANNEL_BITS * i`, the texture set it reads (glTF's `texCoord`, `Texture.channel`), held to
 *  the last set a page carries. */
export function channelsOf(
  mat: VisMaterial,
  fields: readonly ((typeof SURFACE_MAP_FIELDS)[number] | (typeof PHYSICAL_MAP_FIELDS)[number])[],
) {
  let channels = 0
  for (let i = 0; i < fields.length; i++)
    channels |= Math.min(mat[fields[i]]?.channel ?? 0, MAX_UV_SETS - 1) << (MAP_CHANNEL_BITS * i)
  return channels
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
