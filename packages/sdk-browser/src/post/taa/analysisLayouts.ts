import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { velocityInputEntries } from './inputs.ts'
import { CLOSEST_FORMAT, MARKS_FORMAT, VECTOR_FORMAT } from './velocityWgsl.ts'
import { VELOCITY_BINDINGS } from './nearestVelocityWgsl.ts'
import {
  REPROJECT_BINDINGS,
  REPROJECTED_FORMAT,
  SHADING_HISTORY_FORMAT,
  FLICKER_FORMAT,
} from './reprojectWgsl.ts'
import { FLICKER_BINDINGS, FLICKER_ERROR_FORMAT } from './flickerWgsl.ts'
import { THIN_GEOMETRY_BINDINGS, THIN_GEOMETRY_FORMAT } from './thinGeometryWgsl.ts'
import {
  HELD_MEASURE_BINDINGS,
  HELD_MEASURE_FORMAT,
  REJECTION_BINDINGS,
  REJECTION_FORMAT,
} from './rejectionWgsl.ts'
import { LDR_LUMA_FORMAT, SPATIAL_AA_BINDINGS } from './spatialAntiAliasingWgsl.ts'

/** Makes the bind group layout of `entries`. */
type LayoutOf = (entries: GPUBindGroupLayoutEntry[]) => GPUBindGroupLayout

const readOnly = (binding: number) =>
  computeBufferEntry(binding, 'read-only-storage', GPUShaderStage.COMPUTE)

/** The layouts of the analysis's first two passes: the nearest velocity, which reads the frame's
 *  surfaces and writes the closest depth, the marks and the occluders, and the reprojection, which
 *  reads the velocity stage's vectors, the depth, the marks and the histories. */
function texelLayouts(layoutOf: LayoutOf) {
  return {
    velocity: layoutOf([
      ...velocityInputEntries(),
      computeStorageTextureEntry(VELOCITY_BINDINGS.closest, CLOSEST_FORMAT),
      computeStorageTextureEntry(VELOCITY_BINDINGS.marks, MARKS_FORMAT),
      computeBufferEntry(VELOCITY_BINDINGS.occluders, 'storage', GPUShaderStage.COMPUTE),
    ]),
    reproject: layoutOf([
      computeUniformEntry(REPROJECT_BINDINGS.view),
      computeTextureEntry(REPROJECT_BINDINGS.marks, 'uint'),
      computeTextureEntry(REPROJECT_BINDINGS.closest, 'uint'),
      computeTextureEntry(REPROJECT_BINDINGS.vectors, 'uint'),
      readOnly(REPROJECT_BINDINGS.occluders),
      computeTextureEntry(REPROJECT_BINDINGS.prevShading, 'float'),
      computeSamplerEntry(REPROJECT_BINDINGS.historySampler, 'filtering'),
      computeTextureEntry(REPROJECT_BINDINGS.prevFlicker, 'float'),
      computeStorageTextureEntry(REPROJECT_BINDINGS.shading, SHADING_HISTORY_FORMAT),
      computeStorageTextureEntry(REPROJECT_BINDINGS.flicker, FLICKER_FORMAT),
      computeStorageTextureEntry(REPROJECT_BINDINGS.word, REPROJECTED_FORMAT),
      computeStorageTextureEntry(REPROJECT_BINDINGS.filled, VECTOR_FORMAT),
      computeTextureEntry(REPROJECT_BINDINGS.prevThin, 'uint'),
      computeTextureEntry(REPROJECT_BINDINGS.depth, 'depth'),
    ]),
  }
}

/** The layouts of the thin geometry detection, the flicker measure and the held measure. */
function measureLayouts(layoutOf: LayoutOf) {
  return {
    thin: layoutOf([
      computeUniformEntry(THIN_GEOMETRY_BINDINGS.view),
      computeTextureEntry(THIN_GEOMETRY_BINDINGS.depth, 'depth'),
      computeTextureEntry(THIN_GEOMETRY_BINDINGS.ids, 'uint'),
      readOnly(THIN_GEOMETRY_BINDINGS.pages),
      computeTextureEntry(THIN_GEOMETRY_BINDINGS.marks, 'uint'),
      computeTextureEntry(THIN_GEOMETRY_BINDINGS.word, 'uint'),
      computeTextureEntry(THIN_GEOMETRY_BINDINGS.current, 'unfilterable-float'),
      computeTextureEntry(THIN_GEOMETRY_BINDINGS.reactive, 'float'),
      computeStorageTextureEntry(THIN_GEOMETRY_BINDINGS.thinOut, THIN_GEOMETRY_FORMAT),
    ]),
    flicker: layoutOf([
      computeUniformEntry(FLICKER_BINDINGS.view),
      computeTextureEntry(FLICKER_BINDINGS.current, 'unfilterable-float'),
      computeTextureEntry(FLICKER_BINDINGS.reactive, 'float'),
      computeTextureEntry(FLICKER_BINDINGS.word, 'uint'),
      computeTextureEntry(FLICKER_BINDINGS.flicker, 'float'),
      computeTextureEntry(FLICKER_BINDINGS.marks, 'uint'),
      computeStorageTextureEntry(FLICKER_BINDINGS.flickerOut, FLICKER_FORMAT),
      computeStorageTextureEntry(FLICKER_BINDINGS.error, FLICKER_ERROR_FORMAT),
      computeTextureEntry(FLICKER_BINDINGS.thin, 'uint'),
    ]),
    held: layoutOf([
      computeUniformEntry(HELD_MEASURE_BINDINGS.view),
      computeTextureEntry(HELD_MEASURE_BINDINGS.current, 'unfilterable-float'),
      computeTextureEntry(HELD_MEASURE_BINDINGS.word, 'uint'),
      computeTextureEntry(HELD_MEASURE_BINDINGS.shading, 'float'),
      computeStorageTextureEntry(HELD_MEASURE_BINDINGS.filteredInput, HELD_MEASURE_FORMAT),
      computeStorageTextureEntry(HELD_MEASURE_BINDINGS.filteredHistory, HELD_MEASURE_FORMAT),
      computeStorageTextureEntry(HELD_MEASURE_BINDINGS.filteredError, HELD_MEASURE_FORMAT),
      computeBufferEntry(HELD_MEASURE_BINDINGS.occluders, 'storage', GPUShaderStage.COMPUTE),
    ]),
  }
}

/** The layout of the shading rejection. */
const rejectionLayout = (layoutOf: LayoutOf) =>
  layoutOf([
    computeUniformEntry(REJECTION_BINDINGS.view),
    computeTextureEntry(REJECTION_BINDINGS.current, 'unfilterable-float'),
    computeTextureEntry(REJECTION_BINDINGS.word, 'uint'),
    computeTextureEntry(REJECTION_BINDINGS.shading, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.flicker, 'uint'),
    computeStorageTextureEntry(REJECTION_BINDINGS.shadingOut, SHADING_HISTORY_FORMAT),
    computeStorageTextureEntry(REJECTION_BINDINGS.rejection, REJECTION_FORMAT),
    computeStorageTextureEntry(REJECTION_BINDINGS.luma, LDR_LUMA_FORMAT),
    computeTextureEntry(REJECTION_BINDINGS.flickerHistory, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.reactive, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.marks, 'uint'),
    computeTextureEntry(REJECTION_BINDINGS.thin, 'uint'),
    computeTextureEntry(REJECTION_BINDINGS.filteredInput, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.filteredHistory, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.filteredError, 'float'),
  ])

/** The layout of the spatial anti-aliaser's draw. */
const antiAliasLayout = (layoutOf: LayoutOf) => {
  const fragment = GPUShaderStage.FRAGMENT
  return layoutOf([
    computeTextureEntry(SPATIAL_AA_BINDINGS.luma, 'float', '2d', fragment),
    computeUniformEntry(SPATIAL_AA_BINDINGS.view, {}, fragment),
    computeSamplerEntry(SPATIAL_AA_BINDINGS.lumaSampler, 'filtering', fragment),
    computeTextureEntry(SPATIAL_AA_BINDINGS.rejection, 'float', '2d', fragment),
  ])
}

/** The bind group layouts of the temporal pass's analysis, one for each of its passes
 *  (`createTaaAnalysis`). */
export function createAnalysisLayouts(device: GPUDevice) {
  const layoutOf: LayoutOf = (entries) => device.createBindGroupLayout({ entries })
  return {
    ...texelLayouts(layoutOf),
    ...measureLayouts(layoutOf),
    rejection: rejectionLayout(layoutOf),
    antiAlias: antiAliasLayout(layoutOf),
  }
}

/** The analysis's layouts (`createAnalysisLayouts`). */
export type AnalysisLayouts = ReturnType<typeof createAnalysisLayouts>
