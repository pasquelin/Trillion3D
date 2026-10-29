// The rasterization of volumes into the grids: the pools, the parameters, the kernels' texts and the order the passes are encoded in.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { VG_GRID_PARAMS_BYTES } from './gridEvalWgsl.ts'
import { VG_PARAMS_STRIDE, type VoxelGridPasses } from './gridPasses.ts'
import { VG_TRAVERSAL_WGSL } from './gridTraversalWgsl.ts'
import { gridPools, type GridSource } from './gridRasterize.ts'
import { encodeOrthoGrid, type OrthoGridSettings } from './orthoGridBuild.ts'
import { gridParamsOf } from './gridParamsOf.ts'
import {
  packAllocateParams,
  packArgsParams,
  packRasterParams,
  packTileParams,
  type RasterGrid,
} from './rasterPack.ts'
import { VG_RASTER_PARAMS_BYTES } from './rasterParamsWgsl.ts'
import { VG_RASTERIZE_BOTTOM_LEVEL_WGSL } from './rasterizeBottomLevelWgsl.ts'
import { VG_PREPARE_RASTER_SAMPLES_WGSL } from './rasterSamplesWgsl.ts'
import {
  VG_ALLOC_PARAMS_BYTES,
  VG_ALLOCATE_BOTTOM_LEVEL_WGSL,
  VG_ARGS_PARAMS_BYTES,
  VG_GENERATE_RASTER_TILES_WGSL,
  VG_RASTER_ARGS_WGSL,
  VG_TILE_PARAMS_BYTES,
} from './rasterTilesWgsl.ts'
import { renderTransmittanceProgram, VG_TRANSMITTANCE_MODES } from './renderTransmittanceWgsl.ts'
import type { GridView } from './gridPlan.ts'

test('the pools hold a tile for each top-level cell (64 with the indirection grid), the megabytes asked of bottom-level cells and 64 indirection cells a cell, within a binding', () => {
  const big = 1 << 30
  assert.deepEqual(
    gridPools({ cells: 100, indirection: false, memoryMegabytes: 128, maxBinding: big }),
    {
      tiles: 100,
      bottom: 16_000_000,
      indirection: 1,
    },
  )
  assert.deepEqual(
    gridPools({ cells: 100, indirection: true, memoryMegabytes: 1, maxBinding: big }),
    {
      tiles: 6400,
      bottom: 125_000,
      indirection: 6400,
    },
  )
  // A binding of 128 MiB holds 32768 tiles of samples (4 KiB each), 8 Mi extinction cells' worth of 16-byte material cells, 32 Mi indirection cells.
  const small = 128 * 2 ** 20
  const pools = gridPools({
    cells: 4_000_000,
    indirection: true,
    memoryMegabytes: 4096,
    maxBinding: small,
  })
  assert.deepEqual(pools, { tiles: 32768, bottom: 8 * 2 ** 20, indirection: 32 * 2 ** 20 })
  assert.deepEqual(gridPools({ cells: 1, indirection: false, memoryMegabytes: 1, maxBinding: 1 }), {
    tiles: 1,
    bottom: 64,
    indirection: 1,
  })
})

test('the parameters of the allocation, the tiles, the arguments and the rasterization are laid out as the kernels read them', () => {
  const alloc = packAllocateParams({
    resolution: [3, 4, 5],
    indirection: true,
    boundsMin: [-1, -2, -3],
    boundsMax: [1, 2, 3],
    maxVoxelResolution: 4,
    indirectionPool: 777,
  })
  assert.equal(alloc.byteLength, VG_ALLOC_PARAMS_BYTES)
  assert.deepEqual(Array.from(new Int32Array(alloc).slice(0, 4)), [3, 4, 5, 1])
  assert.deepEqual(Array.from(new Float32Array(alloc).slice(4, 7)), [-1, -2, -3])
  assert.equal(new Int32Array(alloc)[7], 4)
  assert.deepEqual(Array.from(new Float32Array(alloc).slice(8, 11)), [1, 2, 3])
  assert.equal(new Uint32Array(alloc)[11], 777)
  const tiles = packTileParams([3, 4, 5], false)
  assert.equal(tiles.byteLength, VG_TILE_PARAMS_BYTES)
  assert.deepEqual(Array.from(new Int32Array(tiles)), [3, 4, 5, 0])
  const args = packArgsParams([65535, 65535, 65535], 1000)
  assert.equal(args.byteLength, VG_ARGS_PARAMS_BYTES)
  assert.deepEqual(Array.from(new Uint32Array(args)), [65535, 65535, 65535, 1000])
  const grid: RasterGrid = {
    kind: 'frustum',
    resolution: [2, 3, 4],
    boundsMin: [0, 0, 0],
    boundsMax: [0, 0, 0],
    indirection: false,
    bottomResolution: 4,
    viewToWorld: Array.from({ length: 16 }, (_, k) => k),
    tanHalfFov: 0.5,
    near: 1,
    far: 90,
    pool: 12345,
  }
  const raster = packRasterParams({
    grid,
    primitiveMin: [1, 2, 3],
    primitiveMax: [4, 5, 6],
    jitter: true,
    frame: 5,
    homogeneousThreshold: -1,
  })
  assert.equal(raster.byteLength, VG_RASTER_PARAMS_BYTES)
  const i = new Int32Array(raster)
  const f = new Float32Array(raster)
  assert.deepEqual(Array.from(i.slice(0, 4)), [2, 3, 4, 1], 'the frustum grid is the grid 1')
  assert.equal(i[7], 0)
  assert.equal(i[11], 4)
  assert.deepEqual(Array.from(f.slice(12, 15)), [1, 2, 3])
  assert.equal(i[15], 1)
  assert.deepEqual(Array.from(f.slice(16, 19)), [4, 5, 6])
  assert.equal(new Uint32Array(raster)[19], 5)
  assert.deepEqual(Array.from(f.slice(20, 36)), Array.from(grid.viewToWorld))
  assert.deepEqual(Array.from(f.slice(36, 40)), [0.5, 1, 90, -1])
  assert.equal(new Uint32Array(raster)[40], 12345)
})

test("the grids' parameters hold the ortho grid and none for the frustum grid, and the voxels a top-level cell holds", () => {
  const bytes = gridParamsOf(
    {
      resolution: [2, 2, 2],
      bounds: { origin: [10, 0, 0], extent: [1, 1, 1] },
      indirection: true,
      cellVoxels: 16,
    } as never,
    undefined,
  )
  assert.equal(bytes.byteLength, VG_GRID_PARAMS_BYTES)
  const f = new Float32Array(bytes)
  const i = new Int32Array(bytes)
  assert.deepEqual(Array.from(f.slice(0, 3)), [9, -1, -1])
  assert.equal(i[3], 1)
  assert.equal(i[7], 1, 'with the indirection grid')
  assert.equal(i[11], 0, 'no frustum grid')
  assert.equal(i[40], 16)
})

const entries = (text: string) =>
  [...text.matchAll(/@compute @workgroup_size\([^)]*\)\s*fn (\w+)/g)].map((m) => m[1])
const bindings = (text: string) => [...text.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]))

test('each kernel declares its entry point over the bindings its layout lists, with no backtick', () => {
  assert.deepEqual(entries(VG_ALLOCATE_BOTTOM_LEVEL_WGSL), ['allocateBottomLevelGrid'])
  assert.deepEqual(entries(VG_GENERATE_RASTER_TILES_WGSL), ['generateRasterTiles'])
  assert.deepEqual(entries(VG_RASTER_ARGS_WGSL), ['setRasterizeBottomLevelGridIndirectArgs'])
  assert.deepEqual(entries(VG_PREPARE_RASTER_SAMPLES_WGSL), ['prepareRasterSamples'])
  assert.deepEqual(entries(VG_RASTERIZE_BOTTOM_LEVEL_WGSL), ['rasterizeBottomLevelGrid'])
  assert.deepEqual(bindings(VG_ALLOCATE_BOTTOM_LEVEL_WGSL), [0, 1, 2])
  assert.deepEqual(bindings(VG_GENERATE_RASTER_TILES_WGSL), [0, 1, 2, 3])
  assert.deepEqual(bindings(VG_RASTER_ARGS_WGSL), [0, 1, 2])
  assert.deepEqual(bindings(VG_PREPARE_RASTER_SAMPLES_WGSL).sort(), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(bindings(VG_RASTERIZE_BOTTOM_LEVEL_WGSL), [0, 1, 2, 3, 4, 5, 6, 7])
  for (const text of [
    VG_ALLOCATE_BOTTOM_LEVEL_WGSL,
    VG_GENERATE_RASTER_TILES_WGSL,
    VG_RASTER_ARGS_WGSL,
    VG_PREPARE_RASTER_SAMPLES_WGSL,
    VG_RASTERIZE_BOTTOM_LEVEL_WGSL,
    wgslModule(VG_TRAVERSAL_WGSL),
  ])
    assert.equal(text.includes('`'), false)
})

test('the barriers of the folding kernel sit outside every branch, the sums are trees, and a full tile stays its cells', () => {
  const text = VG_RASTERIZE_BOTTOM_LEVEL_WGSL.replace(/\s/g, '')
  // A barrier in a branch the group does not all take is refused by the compiler.
  const flat = text.replace(/for\(varstride[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, 'LOOP')
  for (const branch of flat.matchAll(/if\([^)]*\)\{((?:[^{}]|\{[^{}]*\})*)\}/g))
    assert.equal(branch[1].includes('workgroupBarrier'), false)
  // After the loads, after each of the two trees' steps, after the stores of the spread, after the decision.
  assert.equal((text.match(/workgroupBarrier\(\)/g) ?? []).length, 5)
  assert.match(text, /sumExtinction\[slot\]\+=sumExtinction\[slot\+stride\]/)
  // Only the voxels of the tile count in the variance; the first voxel's emission is not the aggregate's.
  assert.match(text, /\)\),inTile\);/)
  assert.match(text, /writeEmission=sumEmission\[0\]\/f32\(baseCells\)/)
  assert.match(text, /writeScattering=sumScattering\[0\]\/f32\(baseCells\)/)
})

test('the transmittance program of each way differs by its mode alone, and a way past the nine is refused', () => {
  const programs = VG_TRANSMITTANCE_MODES.map((_, mode) => renderTransmittanceProgram(mode))
  assert.equal(new Set(programs).size, 9)
  programs.forEach((text, mode) => {
    assert.match(text, new RegExp(`const TRANSMITTANCE_MODE=${mode};`))
    assert.deepEqual(entries(text), ['renderTransmittanceWithVoxelGrid'])
    assert.deepEqual(
      bindings(text).sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    )
    assert.equal(text.includes('`'), false)
    assert.equal(
      text.replace(/const TRANSMITTANCE_MODE=\d;/, ''),
      programs[0].replace(/const TRANSMITTANCE_MODE=\d;/, ''),
    )
  })
  assert.throws(() => renderTransmittanceProgram(9))
  assert.throws(() => renderTransmittanceProgram(-1))
})

test('the walk through a grid starts at the first face ahead of the position and takes the nearest face at each step', () => {
  const { vgDdaStart, vgDdaStep } = shaderRun<{
    vgDdaStart: (p: number[], d: number[], inverse: number[]) => number[]
    vgDdaStep: (
      hit: { get(): number[]; set(v: number[]): void },
      inverse: number[],
      marched: number,
    ) => number
  }>(wgslModule(VG_TRAVERSAL_WGSL), ['vgDdaStart', 'vgDdaStep'], {})
  const direction = [1, 0.5, -0.25]
  const inverse = direction.map((v) => 1 / v)
  const hit = vgDdaStart([0.5, 0.5, 0.5], direction, inverse)
  // The faces ahead: x = 1, y = 1, z = 0; the distances along the ray to each.
  assert.deepEqual(
    hit.map((v) => Math.round(v * 1e5) / 1e5),
    [0.5, 1, 2],
  )
  let held = hit
  const pointer = { get: () => held, set: (v: number[]) => void (held = v) }
  assert.equal(vgDdaStep(pointer, inverse, 0), 0.5)
  assert.deepEqual(
    held.map((v) => Math.round(v * 1e5) / 1e5),
    [1.5, 1, 2],
    'the x face crossed moves one cell on',
  )
  assert.equal(vgDdaStep(pointer, inverse, 0.5), 0.5)
  assert.equal(vgDdaStep(pointer, inverse, 1), 0.5)
})

// ---------- The order the passes are encoded in, on a recording device.

const calls: string[] = []
const fakePass = () => ({
  setPipeline: () => calls.push('pipeline'),
  setBindGroup: () => {},
  dispatchWorkgroups: (...n: number[]) => calls.push(`dispatch ${n}`),
  dispatchWorkgroupsIndirect: () => calls.push('dispatch indirect'),
  end: () => {},
})
const fakeEncoder = () =>
  ({
    beginComputePass: (d: { label: string }) => (
      calls.push(d.label.replace('Trillion3D heterogeneous volume grid ', '')),
      fakePass()
    ),
    clearBuffer: (b: { label: string }) => calls.push(`clear ${b.label}`),
  }) as unknown as GPUCommandEncoder
const fakeDevice = {
  queue: { writeBuffer: () => {} },
  createBindGroup: () => ({}),
} as unknown as GPUDevice
const stage = { layout: {}, pipeline: { get: () => ({}) } }
const passes = new Proxy({}, { get: () => stage }) as unknown as VoxelGridPasses

const SETTINGS: OrthoGridSettings = {
  maxTraceDistance: 30000,
  downsampleFactor: 1,
  minimumVoxelSizeInFrustum: 0.1,
  minimumVoxelSizeOutsideFrustum: 100,
  bottomLevelGridResolution: 4,
  indirectionGrid: true,
  indirectionGridResolution: 4,
  frustumGridShadingRate: 4,
  orthoGrid: true,
  orthoGridShadingRate: 4,
  frustumGridDepthSliceCount: 512,
  farPlaneAutoTransition: true,
  bottomLevelMemoryMegabytes: 1,
  homogeneousThreshold: 0.001,
  majorantGrid: true,
  majorantGridMax: false,
  topLevelBitmask: false,
}
const VIEW: GridView = {
  origin: [0, 0, -50],
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, 1],
  fovDegrees: 60,
  width: 640,
  height: 360,
  planes: Float64Array.from([
    1, 0, 0, 1e6, -1, 0, 0, 1e6, 0, 1, 0, 1e6, 0, -1, 0, 1e6, 0, 0, 1, 1e6, 0, 0, -1, 1e6,
  ]),
}

test('the ortho grid is built in order: cleared, sized, cut into tiles, each volume sampled between its positions and its folding, the majorants last', () => {
  calls.length = 0
  const made = new Map<string, number>()
  const source: GridSource = {
    volume: { origin: [0, 0, 0], extent: [5, 5, 5], radius: 9, minimumVoxelSize: 0.5 },
    boxMin: [-5, -5, -5],
    boxMax: [5, 5, 5],
    sample: () => calls.push('material'),
  }
  const grid = encodeOrthoGrid({
    device: fakeDevice,
    encoder: fakeEncoder(),
    passes,
    bufferOf: (key, size) => (made.set(key, size), { label: key, size } as unknown as GPUBuffer),
    noiseView: {} as GPUTextureView,
    maxBinding: 128 * 2 ** 20,
    mostGroups: 65535,
    view: VIEW,
    orthographic: false,
    planes: new Float32Array(20),
    sources: [source, source],
    options: { shadingRateInFrustum: 1, shadingRateOutOfFrustum: 2, useProjectedPixelSize: true },
    settings: SETTINGS,
    jitter: false,
    frame: 3,
  })
  assert.ok(grid)
  assert.equal(grid.indirection, true)
  assert.equal(grid.cellVoxels, 16)
  const order = calls.filter((call) => !call.startsWith('pipeline') && !call.startsWith('dispatch'))
  const at = (name: string) => order.indexOf(name)
  assert.ok(at('voxel size') < at('bottom level'))
  assert.ok(at('bottom level') < at('raster tiles'))
  // Two volumes: positions, material, folding, twice, in turn.
  assert.deepEqual(
    order.slice(order.indexOf('samples')),
    ['samples', 'material', 'rasterize', 'samples', 'material', 'rasterize'].concat(
      order.slice(order.indexOf('samples') + 6),
    ),
  )
  assert.equal(order.filter((c) => c === 'material').length, 2)
  assert.ok(calls.includes('dispatch indirect'))
  // The buffers: one volume's parameters a slot each.
  assert.equal(made.get('grid ortho raster parameters'), 2 * VG_PARAMS_STRIDE)
  assert.equal(made.get('grid ortho sizes'), 2 * VG_PARAMS_STRIDE)
  assert.ok(made.has('grid ortho majorant'))
})

test('no grid is built where there is no volume', () => {
  assert.equal(
    encodeOrthoGrid({
      device: fakeDevice,
      encoder: fakeEncoder(),
      passes,
      bufferOf: () => ({}) as GPUBuffer,
      noiseView: {} as GPUTextureView,
      maxBinding: 1 << 27,
      mostGroups: 65535,
      view: VIEW,
      orthographic: false,
      planes: new Float32Array(20),
      options: { shadingRateInFrustum: 1, shadingRateOutOfFrustum: 2, useProjectedPixelSize: true },
      jitter: false,
      frame: 0,
      sources: [],
      settings: SETTINGS,
    }),
    undefined,
  )
})
