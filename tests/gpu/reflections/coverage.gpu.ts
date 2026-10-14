// A display's image is traced whole: all-mirror images at 3840 × 2160, 3440 × 1440 and 2880 × 1800,
// every pixel of each written over a not-a-number by the half grid's trace and its upsample
// (`coveragePage.ts`).
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/coverage.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('every pixel of an all-mirror image of a display is traced', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'coveragePage.ts'),
    'reflectionCoverage',
  )) as typeof import('./coveragePage.ts')
  const result = await runOnDawn(page.run, [
    [3840, 2160],
    [3440, 1440],
    [2880, 1800],
  ])
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  console.log(JSON.stringify(result.sizes))
  for (const { size, unwritten } of result.sizes!)
    assert.equal(unwritten, 0, `${size.join('×')}: ${unwritten} pixels unwritten`)
})
