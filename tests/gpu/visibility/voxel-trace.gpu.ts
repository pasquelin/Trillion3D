// A voxel brick draws its box in the real WebGPU engine (`voxelTracePage.ts`), each pixel tracing
// the brick's cells (`voxelWgsl.ts`): its depth is its first voxel's face — a square a hair (0.004,
// 1/60 of a voxel) above the top face hides every voxel, the same square a hair below hides none —,
// its normal is its voxels' — the brick's normal view is the square's —, and its shadow pages trace
// it too: lifted over a floor under a sun, it darkens the floor where it falls.
//
//   node bench/dawn/proofs.ts tests/gpu/visibility/voxel-trace.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assertSoundProof, runPageProof } from '../../kit/device/enginePageProof.ts'
import type { VoxelTraceProof } from './voxelTracePage.ts'

test('a voxel brick shows its traced voxels: depth, normal and shadow', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'voxelTracePage.ts'),
    'voxelTraceProof',
  )) as Awaited<ReturnType<typeof runPageProof>> & VoxelTraceProof
  const { events: _events, ...told } = result
  console.log(JSON.stringify(told))
  assertSoundProof(result)
  const { front, behind, samples } = result
  assert.deepEqual(front, { red: 0, green: samples }, 'the square in front hides every voxel')
  assert.deepEqual(behind, { red: samples, green: 0 }, 'the square behind hides none')
  assert.ok(result.normalGap <= 3, `the brick's normals are its voxels': ${result.normalGap}`)
  assert.ok(
    result.shadowed < result.open * 0.7,
    `the brick casts its shadow: ${JSON.stringify(told)}`,
  )
  assert.ok(Math.abs(result.lit - result.open) <= 4, 'away from it the floor is lit as bare')
})
