// A display's image is traced whole: all-mirror images at 3840 × 2160, 3440 × 1440 and 2880 × 1800
// list more tiles than a dimension of a dispatch holds (or, for the last two, close to it), and
// every pixel of each is written over a not-a-number (`tilesPage.ts`).
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/tiles.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('every pixel of an all-mirror image of a display is traced, whatever the tiles it lists', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'tilesPage.ts'),
    'reflectionTiles',
  )) as typeof import('./tilesPage.ts')
  const result = await runOnDawn(page.run, [
    [3840, 2160],
    [3440, 1440],
    [2880, 1800],
  ])
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  console.log(JSON.stringify(result.sizes))
  for (const { size, unwritten, tiles } of result.sizes!)
    assert.equal(unwritten, 0, `${size.join('×')}: ${unwritten} pixels unwritten of ${tiles} tiles`)
  assert.ok(result.sizes![0].tiles > 65535, 'the first image lists more tiles than a dimension')
})
