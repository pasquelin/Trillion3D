// A voxel brick draws its contours in the real WebGPU engine (`voxelContourPage.ts`), through the
// page geometry every raster reads (`voxelWgsl.ts`): its depth is its contour plane's — a square a
// hair (0.004, 1/60 of a voxel) in front of that plane hides every voxel, the same square a hair
// behind hides none —, its normal is the plane's — the brick's normal view is the square's —, and
// its shadow pages draw it: lifted over a floor under a sun, it darkens the floor where it falls.
//
//   node bench/dawn/proofs.ts tests/gpu/visibility/voxel-contour.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assertSoundProof, runPageProof } from '../kit/enginePageProof.ts'
import type { VoxelContour } from './voxelContourPage.ts'

test('a voxel brick shows its contour plane: depth, normal and shadow', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'voxelContourPage.ts'),
    'voxelContour',
  )) as Awaited<ReturnType<typeof runPageProof>> & VoxelContour
  const { events: _events, ...told } = result
  console.log(JSON.stringify(told))
  assertSoundProof(result)
  const { front, behind, samples } = result
  assert.deepEqual(front, { red: 0, green: samples }, 'the square in front hides every voxel')
  assert.deepEqual(behind, { red: samples, green: 0 }, 'the square behind hides none')
  assert.ok(result.normalGap <= 3, `the brick's normals are the plane's: ${result.normalGap}`)
  assert.ok(
    result.shadowed < result.open * 0.7,
    `the brick casts its shadow: ${JSON.stringify(told)}`,
  )
  assert.ok(Math.abs(result.lit - result.open) <= 4, 'away from it the floor is lit as bare')
})
