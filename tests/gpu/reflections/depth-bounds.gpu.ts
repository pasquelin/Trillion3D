// The reflections' depth bounds pyramid on the GPU (`reflections/boundsPyramid.ts`): a depth
// attachment drawn with its two extrema in opposite corners, the rest cleared, reduced to its last
// level — odd sizes, a row and a column.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/depth-bounds.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('the depth bounds keep both extrema, leave out the clear depth and take odd borders in', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'depthBoundsPage.ts'),
    'depthBoundsPage',
  )) as typeof import('./depthBoundsPage.ts')
  const { values, errors } = await runOnDawn(() => page.run(), null)
  assert.deepEqual(errors, [])
  assert.deepEqual(values, [
    [0.25, 0.875],
    [0.25, 0.875],
    [0.25, 0.875],
  ])
})
