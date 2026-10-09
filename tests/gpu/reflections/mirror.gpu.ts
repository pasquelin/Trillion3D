// The reflection on the GPU (`mirrorPage.ts`, `mirrorScene.ts`): two consecutive still images give
// the same reflection target to the bit — nothing it reads turns with the frame —, and a mirror
// floor shows an emissive quad standing on it where the analytic mirror puts it, sharp, while a
// floor pixel whose mirror ray meets nothing reads the environment (zero here) alone.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/mirror.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { fromHalf } from '../../../packages/math/src/float/half.ts'
import { MIRROR, reflectedPixel } from './mirrorScene.ts'

test('a still mirror reflects the same bits twice, the quad where the mirror puts it', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'mirrorPage.ts'),
    'reflectionMirror',
  )) as typeof import('./mirrorPage.ts')
  const result = await runOnDawn(page.run, undefined)
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  const [first, second] = result.targets!
  assert.deepEqual(second, first, 'two still images: one reflection target, bit for bit')
  const { size, quad } = MIRROR
  const rgb = (x: number, y: number) =>
    [0, 1, 2].map((c) => fromHalf(first[(y * size + x) * 4 + c]))
  // The quad's centre and a point a third of the way up, mirrored by the floor.
  for (const [x, y] of [
    [0, 0],
    [0, 0.5],
    [0.2, -0.4],
  ]) {
    const [px, py] = reflectedPixel(x, y)
    const seen = rgb(px, py)
    for (const c of [0, 1, 2]) assert.ok(Math.abs(seen[c] - quad[c]) < 0.02, `${px},${py}: ${seen}`)
  }
  // Beside the reflection, the floor's mirror ray meets nothing: the environment, zero.
  for (const [px, py] of [
    [10, 120],
    [64, 125],
  ])
    assert.deepEqual(rgb(px, py), [0, 0, 0], `${px},${py}`)
})
