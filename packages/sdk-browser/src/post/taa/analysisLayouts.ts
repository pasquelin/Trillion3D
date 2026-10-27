import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { velocityInputEntries } from './inputs.ts'
import { FUSED_FLATTEN_SLOTS } from '../effects/motionBlur/flattenWgsl.ts'
import {
  FLAT_FORMS,
  TILE_FORMAT,
  type BlurVariant,
} from '../effects/motionBlur/motionBlurLayout.ts'
import { CLOSEST_FORMAT, MARKS_FORMAT } from './velocityWgsl.ts'
import { VELOCITY_BINDINGS } from './nearestVelocityWgsl.ts'
import { FIELD_FORMAT } from './reprojectionFieldWgsl.ts'
import { REPROJECT_BINDINGS, REPROJECTED_FORMAT, FLICKER_FORMAT } from './reprojectWgsl.ts'
import {
  THIN_GEOMETRY_BINDINGS,
  THIN_GEOMETRY_FORMAT,
  THIN_RELAXATION_BINDINGS,
} from './thinGeometryWgsl.ts'
import { MEASURE_BINDINGS } from './flickerLumaWgsl.ts'
import { FLICKER_MEASURE_BINDINGS } from './flickerMeasureWgsl.ts'
import { REJECT_SHADING_BINDINGS, REJECTION_FORMAT } from './rejectionWgsl.ts'
import { SPATIAL_AA_BINDINGS } from './spatialAntiAliasingWgsl.ts'
import type { HistoryFormats } from './historyShape.ts'
import {
  ANTI_ALIAS_MASK,
  LDR_LUMA,
  storageEntry,
  type StorageForm,
  type StorageForms,
} from './storageForms.ts'

/** Makes the bind group layout of `entries`. */
type LayoutOf = (entries: GPUBindGroupLayoutEntry[]) => GPUBindGroupLayout

const readOnly = (binding: number) =>
  computeBufferEntry(binding, 'read-only-storage', GPUShaderStage.COMPUTE)

/** The entries of the nearest velocity's layout: what it reads of the frame, the velocity stage and
 *  the responsiveness of the layers over each pixel, and the closest depth, the marks, the occluders
 *  and the reprojection field's words it writes. */
const velocityEntries = (): GPUBindGroupLayoutEntry[] => [
  ...velocityInputEntries(),
  computeStorageTextureEntry(VELOCITY_BINDINGS.closest, CLOSEST_FORMAT),
  computeStorageTextureEntry(VELOCITY_BINDINGS.marks, MARKS_FORMAT),
  computeBufferEntry(VELOCITY_BINDINGS.occluders, 'storage', GPUShaderStage.COMPUTE),
  computeTextureEntry(VELOCITY_BINDINGS.vectors, 'uint'),
  computeTextureEntry(VELOCITY_BINDINGS.responsive, 'float'),
  computeStorageTextureEntry(VELOCITY_BINDINGS.jacobian, FIELD_FORMAT),
  computeStorageTextureEntry(VELOCITY_BINDINGS.boundary, FIELD_FORMAT),
]

/** The entries of the nearest velocity's layout when it flattens the motion blur's motion of
 *  `variant` too: the blur's uniform, the flattened motion and the tile ranges it writes beside. */
const fusedVelocityEntries = ({ directions, flat }: BlurVariant): GPUBindGroupLayoutEntry[] => [
  ...velocityEntries(),
  computeUniformEntry(FUSED_FLATTEN_SLOTS.params),
  computeStorageTextureEntry(FUSED_FLATTEN_SLOTS.flat, FLAT_FORMS[flat].format),
  computeStorageTextureEntry(FUSED_FLATTEN_SLOTS.tiles, TILE_FORMAT),
  ...(directions > 1
    ? [computeStorageTextureEntry(FUSED_FLATTEN_SLOTS.tilesSecond, TILE_FORMAT)]
    : []),
]

/** Whether a device of `limits` holds the storage textures the nearest velocity binds when it
 *  flattens a blur's motion of `variant` too. */
export const fusedVelocityFits = (limits: GPUSupportedLimits, variant: BlurVariant) =>
  fusedVelocityEntries(variant).filter((entry) => entry.storageTexture).length <=
  limits.maxStorageTexturesPerShaderStage

/** The layouts of the analysis's first two passes: the nearest velocity, which reads the frame's
 *  surfaces and the velocity stage's vectors and writes the closest depth, the marks, the occluders
 *  and the reprojection field's words, and the reprojection, which reads the velocity stage's
 *  vectors, the depth, the marks and the histories — the frame's a pixel may be resurrected from
 *  among them — and writes the reprojected shading histories' layers. */
function texelLayouts(layoutOf: LayoutOf, guide: GPUTextureFormat) {
  return {
    velocity: layoutOf(velocityEntries()),
    reproject: layoutOf([
      computeUniformEntry(REPROJECT_BINDINGS.view),
      computeTextureEntry(REPROJECT_BINDINGS.marks, 'uint'),
      computeTextureEntry(REPROJECT_BINDINGS.closest, 'uint'),
      computeTextureEntry(REPROJECT_BINDINGS.vectors, 'uint'),
      readOnly(REPROJECT_BINDINGS.occluders),
      computeTextureEntry(REPROJECT_BINDINGS.prevShading, 'float'),
      computeSamplerEntry(REPROJECT_BINDINGS.historySampler, 'filtering'),
      computeTextureEntry(REPROJECT_BINDINGS.prevFlicker, 'float'),
      computeStorageTextureEntry(REPROJECT_BINDINGS.shading, guide, 'write-only', '2d-array'),
      computeStorageTextureEntry(REPROJECT_BINDINGS.flicker, FLICKER_FORMAT),
      computeStorageTextureEntry(REPROJECT_BINDINGS.word, REPROJECTED_FORMAT),
      computeStorageTextureEntry(REPROJECT_BINDINGS.field, FIELD_FORMAT, 'write-only', '2d-array'),
      computeTextureEntry(REPROJECT_BINDINGS.prevThin, 'float'),
      computeTextureEntry(REPROJECT_BINDINGS.depth, 'depth'),
      computeTextureEntry(REPROJECT_BINDINGS.resurrectGuide, 'float'),
    ]),
  }
}

/** The layout of the thin geometry detection: the flicker luma and the material's coverage measured
 *  before the translucency among what it reads. */
const thinLayout = (layoutOf: LayoutOf) =>
  layoutOf([
    computeUniformEntry(THIN_GEOMETRY_BINDINGS.view),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.depth, 'depth'),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.luma, 'float'),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.coverage, 'float'),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.marks, 'uint'),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.word, 'uint'),
    computeStorageTextureEntry(THIN_GEOMETRY_BINDINGS.thinOut, THIN_GEOMETRY_FORMAT),
  ])

/** The layout of the thin geometry's weight relaxation: the detection's output, the image and the
 *  translucency it reads, the mask's and the coverage history's layers it writes in `measure`. */
const relaxationLayout = (layoutOf: LayoutOf, measure: GPUTextureFormat) =>
  layoutOf([
    computeUniformEntry(THIN_RELAXATION_BINDINGS.view),
    computeTextureEntry(THIN_RELAXATION_BINDINGS.thin, 'uint'),
    computeTextureEntry(THIN_RELAXATION_BINDINGS.current, 'unfilterable-float'),
    computeTextureEntry(THIN_RELAXATION_BINDINGS.translucency, 'float'),
    computeStorageTextureEntry(THIN_RELAXATION_BINDINGS.maskOut, measure),
    computeStorageTextureEntry(THIN_RELAXATION_BINDINGS.historyOut, measure),
  ])

/** The layouts of the measures taken before the translucency: the flicker luma's, of the image, and
 *  the material coverage's, of the visibility buffer, each writing its layer in `measure`. */
const measureLayouts = (layoutOf: LayoutOf, measure: GPUTextureFormat) => ({
  luma: layoutOf([
    computeUniformEntry(MEASURE_BINDINGS.view),
    computeTextureEntry(MEASURE_BINDINGS.image, 'unfilterable-float'),
    computeStorageTextureEntry(MEASURE_BINDINGS.out, measure),
  ]),
  coverage: layoutOf([
    computeUniformEntry(MEASURE_BINDINGS.view),
    computeTextureEntry(MEASURE_BINDINGS.ids, 'uint'),
    readOnly(MEASURE_BINDINGS.pages),
    computeStorageTextureEntry(MEASURE_BINDINGS.out, measure),
    computeTextureEntry(MEASURE_BINDINGS.flags, 'uint'),
  ]),
})

/** The entries of the flicker measure's layout: the image, the translucency, the reprojection word,
 *  the reprojected flicker history, the marks, the thin geometry mask and the flicker luma it reads;
 *  the flicker history it writes and the buffer of the errors and counts the shading rejection
 *  reads back. */
const flickerMeasureEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(FLICKER_MEASURE_BINDINGS.view),
  computeTextureEntry(FLICKER_MEASURE_BINDINGS.current, 'unfilterable-float'),
  computeTextureEntry(FLICKER_MEASURE_BINDINGS.translucency, 'float'),
  computeTextureEntry(FLICKER_MEASURE_BINDINGS.word, 'uint'),
  computeTextureEntry(FLICKER_MEASURE_BINDINGS.flicker, 'float'),
  computeTextureEntry(FLICKER_MEASURE_BINDINGS.marks, 'uint'),
  computeTextureEntry(FLICKER_MEASURE_BINDINGS.thin, 'float'),
  computeTextureEntry(FLICKER_MEASURE_BINDINGS.measureLuma, 'float'),
  computeStorageTextureEntry(FLICKER_MEASURE_BINDINGS.flickerOut, FLICKER_FORMAT),
  computeBufferEntry(FLICKER_MEASURE_BINDINGS.flickerError, 'storage', GPUShaderStage.COMPUTE),
]

/** The entries of the shading rejection's layout: the image, the translucency, the reprojection word,
 *  the reprojected shading histories' layers, the marks, the thin geometry mask and the depth it
 *  reads, and the flicker measure's errors and counts; the shading history, the rejection and the
 *  reprojection field's layers, the anti-aliaser's mask and its LDR luma it writes — three storage
 *  textures, and up to five where the device grants them, the mask taking priority for the fourth
 *  (`rejectionStorageForms`), each a buffer else —, the occluder words it empties, and the scene
 *  colour it writes as a storage buffer. */
const rejectShadingEntries = (
  guide: GPUTextureFormat,
  { mask, luma }: StorageForms,
): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(REJECT_SHADING_BINDINGS.view),
  computeTextureEntry(REJECT_SHADING_BINDINGS.current, 'unfilterable-float'),
  computeTextureEntry(REJECT_SHADING_BINDINGS.translucency, 'float'),
  computeTextureEntry(REJECT_SHADING_BINDINGS.word, 'uint'),
  computeTextureEntry(REJECT_SHADING_BINDINGS.guides, 'float', '2d-array'),
  computeTextureEntry(REJECT_SHADING_BINDINGS.marks, 'uint'),
  computeTextureEntry(REJECT_SHADING_BINDINGS.thin, 'float'),
  computeTextureEntry(REJECT_SHADING_BINDINGS.thinHistory, 'float'),
  computeTextureEntry(REJECT_SHADING_BINDINGS.depth, 'depth'),
  computeStorageTextureEntry(REJECT_SHADING_BINDINGS.guideOut, guide),
  computeStorageTextureEntry(REJECT_SHADING_BINDINGS.rejection, REJECTION_FORMAT),
  computeStorageTextureEntry(REJECT_SHADING_BINDINGS.field, FIELD_FORMAT, 'write-only', '2d-array'),
  computeBufferEntry(REJECT_SHADING_BINDINGS.occluders, 'storage', GPUShaderStage.COMPUTE),
  computeBufferEntry(REJECT_SHADING_BINDINGS.sceneColor, 'storage', GPUShaderStage.COMPUTE),
  storageEntry(LDR_LUMA, luma, 'write', REJECT_SHADING_BINDINGS.luma),
  storageEntry(ANTI_ALIAS_MASK, mask, 'write', REJECT_SHADING_BINDINGS.antiAliasMask),
  readOnly(REJECT_SHADING_BINDINGS.flickerError),
]

/** The layout of the spatial anti-aliaser's dispatch, its target stored to in `format` (the
 *  device's, `HistoryFormats.antiAlias`). */
const antiAliasLayout = (
  layoutOf: LayoutOf,
  format: GPUTextureFormat,
  mask: StorageForm,
  luma: StorageForm,
) =>
  layoutOf([
    storageEntry(LDR_LUMA, luma, 'read', SPATIAL_AA_BINDINGS.luma),
    computeUniformEntry(SPATIAL_AA_BINDINGS.view),
    storageEntry(ANTI_ALIAS_MASK, mask, 'read', SPATIAL_AA_BINDINGS.mask),
    computeStorageTextureEntry(SPATIAL_AA_BINDINGS.out, format),
  ])

/** The bind group layouts of the temporal pass's analysis, one for each of its passes
 *  (`createTaaAnalysis`), the shading histories and the anti-aliaser's target stored in the device's
 *  formats (`HistoryFormats`), and `fusedVelocity` the nearest velocity's that also flattens the
 *  blur's motion of a variant, made at the first ask. */
export function createAnalysisLayouts(
  device: GPUDevice,
  {
    antiAlias,
    guide,
    measure,
    mask,
    luma,
  }: Pick<HistoryFormats, 'antiAlias' | 'guide' | 'measure' | 'mask' | 'luma'>,
) {
  const layoutOf: LayoutOf = (entries) => device.createBindGroupLayout({ entries })
  const fused = new Map<string, GPUBindGroupLayout>()
  return {
    ...texelLayouts(layoutOf, guide),
    fusedVelocity(variant: BlurVariant) {
      const key = `${variant.directions} ${variant.flat}`
      let layout = fused.get(key)
      if (!layout) fused.set(key, (layout = layoutOf(fusedVelocityEntries(variant))))
      return layout
    },
    thin: thinLayout(layoutOf),
    relaxation: relaxationLayout(layoutOf, measure),
    measure: measureLayouts(layoutOf, measure),
    flicker: layoutOf(flickerMeasureEntries()),
    rejectShading: layoutOf(rejectShadingEntries(guide, { mask, luma })),
    antiAlias: antiAliasLayout(layoutOf, antiAlias, mask, luma),
  }
}

/** The analysis's layouts (`createAnalysisLayouts`). */
export type AnalysisLayouts = ReturnType<typeof createAnalysisLayouts>
