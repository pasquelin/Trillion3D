import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
  storageEntries,
} from '../../../gpu/core/computeBindings.ts'
import { layoutStagesOf } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { VG_CLEAR_TOP_LEVEL_WGSL } from './clearTopLevelWgsl.ts'
import { VG_MAJORANT_WGSL } from './majorantWgsl.ts'
import { VG_MARK_FRUSTUM_GRID_WGSL } from './markFrustumGridWgsl.ts'
import { VG_RASTERIZE_BOTTOM_LEVEL_WGSL } from './rasterizeBottomLevelWgsl.ts'
import { VG_PREPARE_RASTER_SAMPLES_WGSL } from './rasterSamplesWgsl.ts'
import {
  VG_ALLOCATE_BOTTOM_LEVEL_WGSL,
  VG_GENERATE_RASTER_TILES_WGSL,
  VG_RASTER_ARGS_WGSL,
} from './rasterTilesWgsl.ts'
import { VG_TOP_LEVEL_BITMASK_WGSL } from './topLevelBitmaskWgsl.ts'
import { VG_TOP_LEVEL_VOXEL_SIZE_WGSL } from './topLevelVoxelSizeWgsl.ts'

/** The stride of a volume's parameters in the uniform buffer a pass reads them from at a dynamic offset. */
export const VG_PARAMS_STRIDE = 256

/**
 * THE PIPELINES OF THE VOXEL GRID PASSES, prepared once a device off the frame (`layoutStagesOf`): the clear of the top level, the
 * voxel size of its cells, the marking of the frustum grid's, the sizing of the ortho grid's bottom level, the raster tiles and the arguments
 * of the dispatches over them, the voxels a volume is sampled at and the samples folded into the grid, the bitmask and the three majorant
 * kernels. Each has its own bind-group layout, made here with the stage.
 */
export const voxelGridPassesOf = oncePerDevice((device: GPUDevice) => {
  const label = 'Trillion3D heterogeneous volume grid'
  const stage = layoutStagesOf(device, label)
  const dynamic = computeUniformEntry(0, { hasDynamicOffset: true })
  const perVolume = storageEntries({ topLevel: 1 })
  const bitmask = storageEntries({ topLevel: 1, bitmask: 2 })
  const majorant = storageEntries({
    topLevel: 1,
    indirection: 2,
    extinction: 3,
    input: 4,
    output: 5,
  })
  const majorantEntries = [
    computeUniformEntry(0),
    majorant.read('topLevel'),
    majorant.read('indirection'),
    majorant.read('extinction'),
    majorant.read('input'),
    majorant.write('output'),
  ]
  const majorantModule = device.createShaderModule({ label, code: VG_MAJORANT_WGSL })
  const uniform = computeUniformEntry(0)
  const read = (binding: number) => computeBufferEntry(binding, 'read-only-storage')
  const write = (binding: number) => computeBufferEntry(binding, 'storage')
  return {
    clear: stage(
      'clear',
      device.createShaderModule({ label, code: VG_CLEAR_TOP_LEVEL_WGSL }),
      'clearTopLevel',
      [storageEntries({ topLevel: 0 }).write('topLevel')],
    ),
    voxelSize: stage(
      'voxel size',
      device.createShaderModule({ label, code: VG_TOP_LEVEL_VOXEL_SIZE_WGSL }),
      'topLevelGridCalculateVoxelSize',
      [dynamic, perVolume.write('topLevel')],
    ),
    markFrustum: stage(
      'frustum mark',
      device.createShaderModule({ label, code: VG_MARK_FRUSTUM_GRID_WGSL }),
      'markTopLevelGridVoxelsForFrustumGrid',
      [dynamic, perVolume.write('topLevel')],
    ),
    allocate: stage(
      'allocate bottom level',
      device.createShaderModule({ label, code: VG_ALLOCATE_BOTTOM_LEVEL_WGSL }),
      'allocateBottomLevelGrid',
      [uniform, write(1), write(2)],
    ),
    tiles: stage(
      'raster tiles',
      device.createShaderModule({ label, code: VG_GENERATE_RASTER_TILES_WGSL }),
      'generateRasterTiles',
      [uniform, read(1), write(2), write(3)],
    ),
    args: stage(
      'raster arguments',
      device.createShaderModule({ label, code: VG_RASTER_ARGS_WGSL }),
      'setRasterizeBottomLevelGridIndirectArgs',
      [uniform, write(1), write(2)],
    ),
    prepareSamples: stage(
      'raster samples',
      device.createShaderModule({ label, code: VG_PREPARE_RASTER_SAMPLES_WGSL }),
      'prepareRasterSamples',
      [dynamic, read(1), read(2), write(3), write(4), computeTextureEntry(5, 'float')],
    ),
    rasterize: stage(
      'rasterize bottom level',
      device.createShaderModule({ label, code: VG_RASTERIZE_BOTTOM_LEVEL_WGSL }),
      'rasterizeBottomLevelGrid',
      [dynamic, write(1), write(2), write(3), write(4), write(5), read(6), read(7)],
    ),
    bitmask: stage(
      'bitmask',
      device.createShaderModule({ label, code: VG_TOP_LEVEL_BITMASK_WGSL }),
      'topLevelCreateBitmask',
      [computeUniformEntry(0), bitmask.read('topLevel'), bitmask.write('bitmask')],
    ),
    buildMajorant: stage(
      'build majorant',
      majorantModule,
      'buildMajorantVoxelGrid',
      majorantEntries,
    ),
    downsampleMajorant: stage(
      'downsample majorant',
      majorantModule,
      'downsampleMajorantVoxelGrid',
      majorantEntries,
    ),
    copyMaximum: stage(
      'copy maximum',
      majorantModule,
      'copyMaximumIntoMajorantVoxelGrid',
      majorantEntries,
    ),
  }
})

export type VoxelGridPasses = ReturnType<typeof voxelGridPassesOf>
