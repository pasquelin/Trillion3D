// The voxel grid passes: the parameters they read, the buffers they fill and the kernels' texts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { chainBytes, gridBytes, majorantChain } from './gridBuild.ts'
import { packMajorantParams, packMarkParams, packSizeParams } from './gridPack.ts'
import { topLevelBitmaskEntries, VG_TOP_LEVEL_BITMASK_WGSL } from './topLevelBitmaskWgsl.ts'
import { VG_CLEAR_TOP_LEVEL_WGSL } from './clearTopLevelWgsl.ts'
import { VG_MAJORANT_WGSL, VG_MAJORANT_PARAMS_BYTES } from './majorantWgsl.ts'
import { VG_MARK_FRUSTUM_GRID_WGSL, VG_MARK_PARAMS_BYTES } from './markFrustumGridWgsl.ts'
import { VG_TOP_LEVEL_VOXEL_SIZE_WGSL, VG_SIZE_PARAMS_BYTES } from './topLevelVoxelSizeWgsl.ts'
import { VG_TYPES_WGSL } from './gridTypesWgsl.ts'
import type { GridSettings, GridView } from './gridPlan.ts'

const SETTINGS = {
  minimumVoxelSizeInFrustum: 0.1,
  minimumVoxelSizeOutsideFrustum: 100,
  downsampleFactor: 2,
} as GridSettings
const VIEW: GridView = {
  origin: [1, 2, 3],
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, 1],
  fovDegrees: 90,
  width: 800,
  height: 600,
  planes: new Float64Array(24),
}
const VOLUME = {
  origin: [5, 0, 0] as const,
  extent: [1, 2, 3] as const,
  radius: 4,
  minimumVoxelSize: 0.5,
}

test('the voxel size parameters are laid out as the kernel reads them', () => {
  const planes = Float32Array.from({ length: 20 }, (_, i) => 100 + i)
  const bytes = packSizeParams({
    resolution: [4, 5, 6],
    bounds: { origin: [0, 0, 0], extent: [10, 10, 10] },
    volume: VOLUME,
    view: VIEW,
    planes,
    orthographic: false,
    options: { shadingRateInFrustum: 4, shadingRateOutOfFrustum: 8, useProjectedPixelSize: true },
    settings: SETTINGS,
  })
  assert.equal(bytes.byteLength, VG_SIZE_PARAMS_BYTES)
  const i = new Int32Array(bytes)
  const f = new Float32Array(bytes)
  assert.deepEqual(Array.from(i.slice(0, 4)), [4, 5, 6, 1])
  assert.deepEqual(Array.from(f.slice(4, 8)), [-10, -10, -10, 4])
  assert.deepEqual(Array.from(f.slice(8, 12)), [10, 10, 10, 8])
  // The volume's box, and the smaller voxel the volume and the in-frustum minimum ask, the larger of the two.
  assert.deepEqual(Array.from(f.slice(12, 16)), [4, -2, -3, 0.5])
  assert.deepEqual(Array.from(f.slice(16, 20)), [6, 2, 3, 100])
  assert.deepEqual(Array.from(f.slice(20, 24)), [1, 2, 3, 2])
  assert.deepEqual(Array.from(f.slice(24, 28)), [1, 800, 0, 0])
  assert.deepEqual(Array.from(f.slice(28, 32)), [0, 0, 1, 0])
  assert.deepEqual(Array.from(f.slice(32, 52)), Array.from(planes))
})

test('the frustum marking parameters are laid out as the kernel reads them', () => {
  const m = Array.from({ length: 16 }, (_, k) => k)
  const bytes = packMarkParams({
    resolution: [7, 8, 9],
    volume: VOLUME,
    viewToWorld: m,
    fovDegrees: 90,
    near: 1,
    far: 50,
    bottomLevelGridResolution: 3,
  })
  assert.equal(bytes.byteLength, VG_MARK_PARAMS_BYTES)
  const f = new Float32Array(bytes)
  assert.deepEqual(Array.from(f.slice(0, 16)), m)
  assert.deepEqual(Array.from(f.slice(16, 24)), [4, -2, -3, 1, 6, 2, 3, 1])
  assert.deepEqual(Array.from(new Int32Array(bytes).slice(24, 26)), [7, 8])
  assert.equal(new Int32Array(bytes)[26], 9)
  assert.equal(f[27], 50)
  assert.equal(new Uint32Array(bytes)[28], 3)
})

test('the majorant parameters hold the top level, the indirection flag and the input grid', () => {
  const bytes = packMajorantParams([3, 4, 5], true, [2, 2, 2])
  assert.equal(bytes.byteLength, VG_MAJORANT_PARAMS_BYTES)
  assert.deepEqual(Array.from(new Int32Array(bytes)), [3, 4, 5, 1, 2, 2, 2, 0])
})

test('the majorant chain folds four cells a side at a time down to one cell, and its scratch holds the first', () => {
  assert.deepEqual(majorantChain([1, 1, 1]), [])
  assert.deepEqual(majorantChain([8, 8, 8]), [
    [2, 2, 2],
    [1, 1, 1],
  ])
  // The axes that end first stay one cell while the others go on.
  assert.deepEqual(majorantChain([40, 3, 1]), [
    [10, 1, 1],
    [3, 1, 1],
    [1, 1, 1],
  ])
  assert.equal(chainBytes([8, 8, 8]), 256)
  assert.equal(chainBytes([64, 64, 64]), 16 * 16 * 16 * 8)
  assert.equal(chainBytes([1, 1, 1]), 256)
})

test('the bitmask has the Morton extent of the 4-cell blocks, and the buffers hold their cells', () => {
  assert.equal(topLevelBitmaskEntries([4, 4, 4]), 1)
  assert.equal(topLevelBitmaskEntries([5, 1, 1]), 8)
  assert.equal(topLevelBitmaskEntries([128, 128, 256]), 64 ** 3)
  assert.deepEqual(gridBytes([2, 3, 4]), { topLevel: 96, bitmask: 8, majorant: 192 })
})

test('each kernel text declares its entry points over the bindings its layout lists', () => {
  const entries = (text: string) =>
    [...text.matchAll(/@compute @workgroup_size\([^)]*\)\s*fn (\w+)/g)].map((m) => m[1])
  assert.deepEqual(entries(VG_CLEAR_TOP_LEVEL_WGSL), ['clearTopLevel'])
  assert.deepEqual(entries(VG_TOP_LEVEL_VOXEL_SIZE_WGSL), ['topLevelGridCalculateVoxelSize'])
  assert.deepEqual(entries(VG_MARK_FRUSTUM_GRID_WGSL), ['markTopLevelGridVoxelsForFrustumGrid'])
  assert.deepEqual(entries(VG_TOP_LEVEL_BITMASK_WGSL), ['topLevelCreateBitmask'])
  assert.deepEqual(entries(VG_MAJORANT_WGSL), [
    'buildMajorantVoxelGrid',
    'downsampleMajorantVoxelGrid',
    'copyMaximumIntoMajorantVoxelGrid',
  ])
  const bindings = (text: string) =>
    [...text.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]))
  assert.deepEqual(bindings(VG_CLEAR_TOP_LEVEL_WGSL), [0])
  assert.deepEqual(bindings(VG_TOP_LEVEL_VOXEL_SIZE_WGSL), [0, 1])
  assert.deepEqual(bindings(VG_MARK_FRUSTUM_GRID_WGSL), [0, 1])
  assert.deepEqual(bindings(VG_TOP_LEVEL_BITMASK_WGSL), [0, 1, 2])
  assert.deepEqual(bindings(VG_MAJORANT_WGSL), [0, 1, 2, 3, 4, 5])
  for (const text of [
    VG_CLEAR_TOP_LEVEL_WGSL,
    VG_TOP_LEVEL_VOXEL_SIZE_WGSL,
    VG_MARK_FRUSTUM_GRID_WGSL,
    VG_TOP_LEVEL_BITMASK_WGSL,
    VG_MAJORANT_WGSL,
  ])
    assert.equal(text.includes('`'), false)
})

test('a cleared cell is empty, a size is a float in the cell, the empty index is the one the clear leaves', () => {
  const types = wgslModule(VG_TYPES_WGSL)
  assert.match(types, /const VG_EMPTY_INDEX=0x1FFFFFFFu/)
  assert.match(VG_CLEAR_TOP_LEVEL_WGSL, /0xFFFFFFF8u/)
  // 0xFFFFFFF8 >> 3 is the empty index, its low three bits no cells.
  assert.equal(0xfffffff8 >>> 3, 0x1fffffff)
  assert.equal(0xfffffff8 & 7, 0)
})

test("the frustum marking gives the marked cell the bottom level's resolution, not a fixed one", () => {
  assert.match(VG_MARK_FRUSTUM_GRID_WGSL.replace(/\s/g, ''), /cells=params\.bottomResolution\.x/)
  assert.doesNotMatch(VG_MARK_FRUSTUM_GRID_WGSL, /cells=4u/)
})

test('the downsample folds the group with a barrier between reading and writing each step', () => {
  const body = VG_MAJORANT_WGSL.slice(VG_MAJORANT_WGSL.indexOf('fn downsampleMajorantVoxelGrid'))
  const loop = body.slice(body.indexOf('for(var stride'), body.indexOf('if(slot==0u)'))
  assert.equal((loop.match(/workgroupBarrier\(\)/g) ?? []).length, 2)
  assert.ok(loop.indexOf('var folded') < loop.indexOf('workgroupBarrier()'))
})
