// The sparse voxels: the plan of their generation, the parameters the passes read and the kernels' texts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SV_ALLOCATE_SPARSE_VOXELS_WGSL } from './allocateSparseVoxelsWgsl.ts'
import { SV_ALLOCATE_TO_REFINE_WGSL } from './allocateToRefineWgsl.ts'
import { SV_CLEAR_ALLOCATOR_WGSL } from './clearAllocatorWgsl.ts'
import { SV_GROUP_ARGS_WGSL } from './groupArgsWgsl.ts'
import { SV_FLUSH_REFINED_WGSL, SV_REFINE_SPARSE_VOXELS_WGSL } from './refineSparseVoxelsWgsl.ts'
import { SV_BLAS_WGSL } from './sparseVoxelBlasWgsl.ts'
import { packSparseVoxelParams, sparseVoxelParameterSlots } from './sparseVoxelEncode.ts'
import {
  mipCountOf,
  mipVolumeResolution,
  sparseVoxelMipBias,
  voxelCountOf,
  voxelListBytes,
} from './sparseVoxelPlan.ts'
import { SV_PARAMS_BYTES, SV_ROW_THREADS } from './voxelDataWgsl.ts'

test('the grid of a mip level is the volume shifted down, never under one voxel', () => {
  assert.deepEqual(mipVolumeResolution([64, 32, 3], 2), [16, 8, 1])
  assert.deepEqual(mipVolumeResolution([1, 1, 1], 5), [1, 1, 1])
  assert.equal(voxelCountOf([4, 5, 6]), 120)
  assert.equal(voxelListBytes([4, 5, 6]), 960)
})

test('the min texture holds a level down to one voxel on its longest side', () => {
  assert.equal(mipCountOf([64, 32, 3]), 7)
  assert.equal(mipCountOf([1, 1, 1]), 1)
  assert.equal(mipCountOf([5, 1, 1]), 3)
})

test('the mip bias of the generation is held to 0-10', () => {
  assert.equal(sparseVoxelMipBias(-3), 0)
  assert.equal(sparseVoxelMipBias(4), 4)
  assert.equal(sparseVoxelMipBias(99), 10)
})

test('a generation takes the first step, each level and the end a slot', () => {
  assert.equal(sparseVoxelParameterSlots(1), 2)
  assert.equal(sparseVoxelParameterSlots(7), 8)
})

test('the parameters are laid out as the kernels read them', () => {
  const bytes = packSparseVoxelParams({
    resolution: [4, 5, 6],
    mip: 2,
    volumeResolution: [16, 20, 24],
    boundsOrigin: [1, 2, 3],
    boundsExtent: [0.5, 0.25, 0.125],
  })
  assert.equal(bytes.byteLength, SV_PARAMS_BYTES)
  assert.deepEqual(Array.from(new Uint32Array(bytes).slice(0, 8)), [4, 5, 6, 2, 16, 20, 24, 0])
  assert.deepEqual(
    Array.from(new Float32Array(bytes).slice(8, 16)),
    [1, 2, 3, 0, 0.5, 0.25, 0.125, 0],
  )
})

test('each kernel text declares its entry point over the bindings its layout lists', () => {
  const entry = (text: string) =>
    [...text.matchAll(/@compute @workgroup_size\([^)]*\)\s*fn (\w+)/g)].map((m) => m[1])
  const bindings = (text: string) =>
    [...text.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]))
  const cases: [string, string, number[]][] = [
    [SV_CLEAR_ALLOCATOR_WGSL, 'clearAllocator', [0]],
    [SV_ALLOCATE_SPARSE_VOXELS_WGSL, 'allocateSparseVoxels', [0, 1, 2, 3]],
    [SV_ALLOCATE_TO_REFINE_WGSL, 'allocateSparseVoxelsToRefine', [0, 1, 2, 3, 4, 5]],
    [SV_REFINE_SPARSE_VOXELS_WGSL, 'refineSparseVoxels', [0, 1, 2, 3, 4, 5, 6, 7]],
    [SV_FLUSH_REFINED_WGSL, 'flushRefinedVoxels', [0, 1, 2, 3, 4]],
    [SV_GROUP_ARGS_WGSL, 'groupArgs', [0, 1]],
    [SV_BLAS_WGSL, 'createSparseVoxelBlas', [0, 1, 2, 3]],
  ]
  for (const [text, name, ids] of cases) {
    assert.deepEqual(entry(text), [name])
    assert.deepEqual(bindings(text), ids, name)
    assert.equal(text.includes('`'), false, name)
  }
})

test('a list is dispatched in rows of 32768 groups and its kernels read the same row width', () => {
  assert.equal(SV_ROW_THREADS, 32768 * 64)
  assert.match(SV_GROUP_ARGS_WGSL, /min\(max\(groups,1u\),32768u\)/)
  for (const text of [SV_REFINE_SPARSE_VOXELS_WGSL, SV_FLUSH_REFINED_WGSL, SV_BLAS_WGSL])
    assert.match(text, /id\.y\*SV_ROW_THREADS\+id\.x/)
})

test('the refinement keeps what the last level merges up, and bounds every read of the texture', () => {
  assert.match(SV_FLUSH_REFINED_WGSL, /voxels\[entry\]=toRefine\[at\]/)
  assert.match(SV_ALLOCATE_TO_REFINE_WGSL, /if\(any\(cell>=params\.resolution\)\)\{return false;\}/)
  assert.match(
    SV_REFINE_SPARSE_VOXELS_WGSL,
    /if\(any\(cell>=params\.resolution\)\)\{allFilled=false;continue;\}/,
  )
})
