// The froxel grid (`froxelGrid.ts`): the constants written from a projection and the slice, depth, centre and box
// the shipped WGSL computes from them, run in JavaScript.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import {
  FROXEL_MARK_LOCAL_LIGHTS_WORD,
  FROXEL_TILE_SIZE,
  VSM_FROXEL_GRID_WGSL,
  writeFroxelGrid,
} from './froxelGrid.ts'

// A +z-forward perspective projection (reversed depth, infinite far) of 90 degrees over a 1600 x 800 view, near 0.5.
const NEAR = 0.5
const toClip = new Float32Array(16)
toClip[0] = 1
toClip[5] = 2
toClip[10] = 0
toClip[11] = 1
toClip[14] = NEAR

test('the grid’s slices are as deep as they are wide, the near plane read off the projection', () => {
  const data = new ArrayBuffer(160)
  writeFroxelGrid(data, {
    viewToClip: toClip,
    perspective: true,
    viewRectMin: [0, 0],
    viewSize: [1600, 800],
    viewToShifted: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    capacity: 100,
    markLocalLights: true,
  })
  const f = new Float32Array(data),
    u = new Uint32Array(data)
  // The words after the matrix (16), the tile scale and bias (4), the depth words (4): near, depth scale + 1, 1 / near.
  assert.equal(f[24], NEAR)
  // The narrower of the tile’s spans over the unit depth: 2 · 8 / 800 over the projection’s scale 2.
  const radius = (2 * FROXEL_TILE_SIZE) / 800 / 2
  assert.ok(Math.abs(f[28]! - radius) < 1e-9, `radius ${f[28]}`)
  assert.ok(Math.abs(f[25]! - (1 + radius)) < 1e-7)
  assert.equal(u[31], 100, 'the room')
  assert.equal(u[FROXEL_MARK_LOCAL_LIGHTS_WORD], 1, 'the local lights are marked')
  const grid = {
    near: f[24]!,
    depthScale1: f[25]!,
    recNear: f[26]!,
    recLog2DepthScale1: f[27]!,
    radius: f[28]!,
    invRadius: f[29]!,
    isOrtho: 0,
    toViewScaleBias: [f[16]!, f[17]!, f[18]!, f[19]!],
  }
  const run = shaderRun<{
    vsmFroxelSlice(depth: number): number
    vsmFroxelDepth(slice: number): number
  }>(VSM_FROXEL_GRID_WGSL, ['vsmFroxelSlice', 'vsmFroxelDepth'], {
    froxelGrid: grid,
    pow: Math.pow,
    FROXEL_INVALID_SLICE: 1 << 28,
  })
  for (const slice of [0, 5, 40, 200]) {
    const depth = run.vsmFroxelDepth(slice)
    assert.equal(run.vsmFroxelSlice(depth * 1.0001), slice, `slice ${slice} at its start`)
    assert.equal(
      run.vsmFroxelSlice(run.vsmFroxelDepth(slice + 1) * 0.9999),
      slice,
      `…and at its end`,
    )
  }
})
