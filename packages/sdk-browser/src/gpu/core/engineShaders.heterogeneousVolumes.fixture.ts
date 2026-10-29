// The heterogeneous volumes' WGSL texts of `ENGINE_SHADERS`: the lighting cache and the march over the
// graph of a volume that reads a sparse volume texture, and the composition over the lit image.
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { compileGraph } from '../../materials/graph/compile.ts'
import { colorSampleWgsl, SHADOW_TILE_POOL_WGSL } from '../../materials/virtual/wgsl.ts'
import {
  compositeProgram,
  liveShadingProgram,
} from '../../lighting/heterogeneousVolumes/liveShadingProgram.ts'
import { PACK_WGSL } from '../../lighting/heterogeneousVolumes/beerShadowMapPackWgsl.ts'
import { SV_ALLOCATE_SPARSE_VOXELS_WGSL } from '../../lighting/heterogeneousVolumes/sparseVoxels/allocateSparseVoxelsWgsl.ts'
import { SV_ALLOCATE_TO_REFINE_WGSL } from '../../lighting/heterogeneousVolumes/sparseVoxels/allocateToRefineWgsl.ts'
import { SV_CLEAR_ALLOCATOR_WGSL } from '../../lighting/heterogeneousVolumes/sparseVoxels/clearAllocatorWgsl.ts'
import { SV_GROUP_ARGS_WGSL } from '../../lighting/heterogeneousVolumes/sparseVoxels/groupArgsWgsl.ts'
import {
  SV_FLUSH_REFINED_WGSL,
  SV_REFINE_SPARSE_VOXELS_WGSL,
} from '../../lighting/heterogeneousVolumes/sparseVoxels/refineSparseVoxelsWgsl.ts'
import {
  SV_BOX_HIERARCHY_WGSL,
  SV_MIN_LEVEL_WGSL,
} from '../../lighting/heterogeneousVolumes/sparseVoxels/boxHierarchyWgsl.ts'
import { SV_BLAS_WGSL } from '../../lighting/heterogeneousVolumes/sparseVoxels/sparseVoxelBlasWgsl.ts'
import { AVSM_COMBINE_WGSL } from '../../lighting/heterogeneousVolumes/volumetricShadow/combineVolumetricShadowMapsWgsl.ts'
import { AVSM_COMPRESS_WGSL } from '../../lighting/heterogeneousVolumes/volumetricShadow/compressVolumetricShadowMapWgsl.ts'
import { avsmConvertToBeerProgram } from '../../lighting/heterogeneousVolumes/volumetricShadow/convertAvsmToBeerWgsl.ts'
import { AVSM_CONVERT_BEER_WGSL } from '../../lighting/heterogeneousVolumes/volumetricShadow/convertBeerToAvsmWgsl.ts'
import { avsmRenderProgram } from '../../lighting/heterogeneousVolumes/volumetricShadow/renderVolumetricShadowMapWgsl.ts'
import { VG_CLEAR_TOP_LEVEL_WGSL } from '../../lighting/heterogeneousVolumes/voxelGrid/clearTopLevelWgsl.ts'
import { VG_RASTERIZE_BOTTOM_LEVEL_WGSL } from '../../lighting/heterogeneousVolumes/voxelGrid/rasterizeBottomLevelWgsl.ts'
import { VG_PREPARE_RASTER_SAMPLES_WGSL } from '../../lighting/heterogeneousVolumes/voxelGrid/rasterSamplesWgsl.ts'
import {
  VG_ALLOCATE_BOTTOM_LEVEL_WGSL,
  VG_GENERATE_RASTER_TILES_WGSL,
  VG_RASTER_ARGS_WGSL,
} from '../../lighting/heterogeneousVolumes/voxelGrid/rasterTilesWgsl.ts'
import {
  renderTransmittanceProgram,
  VG_TRANSMITTANCE_MODES,
} from '../../lighting/heterogeneousVolumes/voxelGrid/renderTransmittanceWgsl.ts'
import { VG_MAJORANT_WGSL } from '../../lighting/heterogeneousVolumes/voxelGrid/majorantWgsl.ts'
import { VG_MARK_FRUSTUM_GRID_WGSL } from '../../lighting/heterogeneousVolumes/voxelGrid/markFrustumGridWgsl.ts'
import { VG_TOP_LEVEL_BITMASK_WGSL } from '../../lighting/heterogeneousVolumes/voxelGrid/topLevelBitmaskWgsl.ts'
import { VG_TOP_LEVEL_VOXEL_SIZE_WGSL } from '../../lighting/heterogeneousVolumes/voxelGrid/topLevelVoxelSizeWgsl.ts'

/** A volume whose extinction and emission are a read of the sparse volume texture of the scene's node 0, its albedo a read of node 1's. */
const compiled = (() => {
  const g = material.graph('volume')
  const read = g.sparseVolumeTextureSample(0)
  g.output('subsurfaceColor', g.channel(read, 'rgb'))
  g.output('baseColor', g.channel(g.sparseVolumeTextureSample(1, { attributes: 1 }), 'rgb'))
  g.output('emissive', g.channel(read, 'rgb'))
  return compileGraph(g, {
    sample: colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
    derivatives: 'neighbours',
    named: true,
  })
})()

export const HETEROGENEOUS_VOLUME_SHADERS: Record<string, string> = {
  HETEROGENEOUS_VOLUME: liveShadingProgram(compiled),
  HETEROGENEOUS_VOLUME_HOLDOUT: liveShadingProgram(compiled, 'rgba16float', true),
  HETEROGENEOUS_VOLUME_BOXES: liveShadingProgram(compiled, 'rgba16float', false, 'boxes'),
  HETEROGENEOUS_VOLUME_AVSM_BUILD: liveShadingProgram(compiled, 'rgba16float', false, 'avsm'),
  HETEROGENEOUS_VOLUME_COMPOSE: compositeProgram(),
  HETEROGENEOUS_VOLUME_BEER_PACK: PACK_WGSL,
  HETEROGENEOUS_VOLUME_GRID_CLEAR: VG_CLEAR_TOP_LEVEL_WGSL,
  HETEROGENEOUS_VOLUME_GRID_VOXEL_SIZE: VG_TOP_LEVEL_VOXEL_SIZE_WGSL,
  HETEROGENEOUS_VOLUME_GRID_MARK_FRUSTUM: VG_MARK_FRUSTUM_GRID_WGSL,
  HETEROGENEOUS_VOLUME_GRID_ALLOCATE_BOTTOM_LEVEL: VG_ALLOCATE_BOTTOM_LEVEL_WGSL,
  HETEROGENEOUS_VOLUME_GRID_RASTER_TILES: VG_GENERATE_RASTER_TILES_WGSL,
  HETEROGENEOUS_VOLUME_GRID_RASTER_ARGS: VG_RASTER_ARGS_WGSL,
  HETEROGENEOUS_VOLUME_GRID_RASTER_SAMPLES: VG_PREPARE_RASTER_SAMPLES_WGSL,
  HETEROGENEOUS_VOLUME_GRID_RASTERIZE: VG_RASTERIZE_BOTTOM_LEVEL_WGSL,
  HETEROGENEOUS_VOLUME_GRID_BITMASK: VG_TOP_LEVEL_BITMASK_WGSL,
  HETEROGENEOUS_VOLUME_GRID_MAJORANT: VG_MAJORANT_WGSL,
  HETEROGENEOUS_VOLUME_SPARSE_CLEAR: SV_CLEAR_ALLOCATOR_WGSL,
  HETEROGENEOUS_VOLUME_SPARSE_ALLOCATE: SV_ALLOCATE_SPARSE_VOXELS_WGSL,
  HETEROGENEOUS_VOLUME_SPARSE_ALLOCATE_TO_REFINE: SV_ALLOCATE_TO_REFINE_WGSL,
  HETEROGENEOUS_VOLUME_SPARSE_REFINE: SV_REFINE_SPARSE_VOXELS_WGSL,
  HETEROGENEOUS_VOLUME_SPARSE_FLUSH: SV_FLUSH_REFINED_WGSL,
  HETEROGENEOUS_VOLUME_SPARSE_GROUP_ARGS: SV_GROUP_ARGS_WGSL,
  HETEROGENEOUS_VOLUME_SPARSE_BLAS: SV_BLAS_WGSL,
  HETEROGENEOUS_VOLUME_SPARSE_MIN_LEVEL: SV_MIN_LEVEL_WGSL,
  HETEROGENEOUS_VOLUME_SPARSE_HIERARCHY: SV_BOX_HIERARCHY_WGSL,
  HETEROGENEOUS_VOLUME_AVSM_FROM_BEER: AVSM_CONVERT_BEER_WGSL,
  HETEROGENEOUS_VOLUME_AVSM_TO_BEER_16: avsmConvertToBeerProgram('rgba16float'),
  HETEROGENEOUS_VOLUME_AVSM_TO_BEER_32: avsmConvertToBeerProgram('rgba32float'),
  HETEROGENEOUS_VOLUME_AVSM_COMPRESS: AVSM_COMPRESS_WGSL,
  HETEROGENEOUS_VOLUME_AVSM_COMBINE: AVSM_COMBINE_WGSL,
  HETEROGENEOUS_VOLUME_AVSM_RENDER_16: avsmRenderProgram('rgba16float'),
  HETEROGENEOUS_VOLUME_AVSM_RENDER_32: avsmRenderProgram('rgba32float'),
  // The transmittance through the grids, a program for each way of finding it.
  ...Object.fromEntries(
    VG_TRANSMITTANCE_MODES.map((mode, index) => [
      `HETEROGENEOUS_VOLUME_GRID_TRANSMITTANCE_${mode.toUpperCase().replaceAll('-', '_')}`,
      renderTransmittanceProgram(index),
    ]),
  ),
}
