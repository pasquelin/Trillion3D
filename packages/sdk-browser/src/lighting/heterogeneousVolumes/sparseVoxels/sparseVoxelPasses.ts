import {
  computeStorageEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { layoutStagesOf } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { SV_ALLOCATE_SPARSE_VOXELS_WGSL } from './allocateSparseVoxelsWgsl.ts'
import { SV_ALLOCATE_TO_REFINE_WGSL } from './allocateToRefineWgsl.ts'
import { SV_CLEAR_ALLOCATOR_WGSL } from './clearAllocatorWgsl.ts'
import { SV_GROUP_ARGS_WGSL } from './groupArgsWgsl.ts'
import { SV_FLUSH_REFINED_WGSL, SV_REFINE_SPARSE_VOXELS_WGSL } from './refineSparseVoxelsWgsl.ts'
import { SV_BOX_HIERARCHY_WGSL, SV_MIN_LEVEL_WGSL } from './boxHierarchyWgsl.ts'
import { SV_BLAS_WGSL } from './sparseVoxelBlasWgsl.ts'

const params = computeUniformEntry(0)
const minTexture = computeTextureEntry(1, 'unfilterable-float', '3d')

/**
 * THE PIPELINES OF THE SPARSE VOXEL PASSES, prepared once a device off the frame: the counter's clear, the one-step allocation, the first step of
 * the refinement, a step of it, its end, the dispatch's arguments from a counter, the boxes of the acceleration structure, the levels of the min texture and the hierarchy built over the boxes. Each has its own
 * bind-group layout, the stage's.
 */
export const sparseVoxelPassesOf = oncePerDevice((device: GPUDevice) => {
  const label = 'Trillion3D heterogeneous volume sparse voxels'
  const stage = layoutStagesOf(device, label)
  return {
    clear: stage(
      'clear',
      device.createShaderModule({ label, code: SV_CLEAR_ALLOCATOR_WGSL }),
      'clearAllocator',
      [computeStorageEntry(0, true)],
    ),
    allocate: stage(
      'allocate',
      device.createShaderModule({ label, code: SV_ALLOCATE_SPARSE_VOXELS_WGSL }),
      'allocateSparseVoxels',
      [params, minTexture, computeStorageEntry(2, true), computeStorageEntry(3, true)],
    ),
    allocateToRefine: stage(
      'allocate to refine',
      device.createShaderModule({ label, code: SV_ALLOCATE_TO_REFINE_WGSL }),
      'allocateSparseVoxelsToRefine',
      [
        params,
        minTexture,
        computeStorageEntry(2, true),
        computeStorageEntry(3, true),
        computeStorageEntry(4, true),
        computeStorageEntry(5, true),
      ],
    ),
    refine: stage(
      'refine',
      device.createShaderModule({ label, code: SV_REFINE_SPARSE_VOXELS_WGSL }),
      'refineSparseVoxels',
      [
        params,
        minTexture,
        computeStorageEntry(2, false),
        computeStorageEntry(3, false),
        computeStorageEntry(4, true),
        computeStorageEntry(5, true),
        computeStorageEntry(6, true),
        computeStorageEntry(7, true),
      ],
    ),
    flush: stage(
      'flush',
      device.createShaderModule({ label, code: SV_FLUSH_REFINED_WGSL }),
      'flushRefinedVoxels',
      [
        params,
        computeStorageEntry(1, false),
        computeStorageEntry(2, false),
        computeStorageEntry(3, true),
        computeStorageEntry(4, true),
      ],
    ),
    groupArgs: stage(
      'group arguments',
      device.createShaderModule({ label, code: SV_GROUP_ARGS_WGSL }),
      'groupArgs',
      [computeStorageEntry(0, false), computeStorageEntry(1, true)],
    ),
    blas: stage(
      'boxes',
      device.createShaderModule({ label, code: SV_BLAS_WGSL }),
      'createSparseVoxelBlas',
      [
        params,
        computeStorageEntry(1, false),
        computeStorageEntry(2, false),
        computeStorageEntry(3, true),
      ],
    ),
    minLevel: stage(
      'min level',
      device.createShaderModule({ label, code: SV_MIN_LEVEL_WGSL }),
      'buildMinLevel',
      [params, minTexture, computeStorageTextureEntry(2, 'rgba16float', 'write-only', '3d')],
    ),
    hierarchy: stage(
      'box hierarchy',
      device.createShaderModule({ label, code: SV_BOX_HIERARCHY_WGSL }),
      'buildBoxHierarchy',
      [
        params,
        computeStorageEntry(1, false),
        computeStorageEntry(2, false),
        computeStorageEntry(3, true),
      ],
    ),
  }
})

export type SparseVoxelPasses = ReturnType<typeof sparseVoxelPassesOf>
