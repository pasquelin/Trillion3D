// A mirror floor shows the wall behind a pole one pixel wide and a fence four pixels wide, and a
// crate deeper than the thickness the march assumes still stops the rays that meet it
// (`thinPage.ts`).
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/thin.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('a ray passes behind a pole and a fence to the wall, a deep crate still stops it', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'thinPage.ts'),
    'reflectionThin',
  )) as typeof import('./thinPage.ts')
  const result = await runOnDawn(page.run, undefined)
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  const { behind = 0, behindWall = 0, crate = 0, crateCrate = 0, wallAll = 0, wallHue = 0 } = result
  console.log(JSON.stringify({ wallAll, wallHue, behind, behindWall, crate, crateCrate }))
  assert.ok(
    wallHue >= 0.99 * wallAll,
    `${wallHue} of ${wallAll} floor pixels show the wall they meet`,
  )
  assert.ok(behind > 100, `${behind} floor pixels see the wall behind the pole or the fence`)
  assert.ok(behindWall >= 0.95 * behind, `${behindWall} of ${behind} show the wall`)
  assert.ok(crate > 100, `${crate} floor pixels see the crate`)
  assert.ok(crateCrate >= 0.9 * crate, `${crateCrate} of ${crate} show the crate`)
})
