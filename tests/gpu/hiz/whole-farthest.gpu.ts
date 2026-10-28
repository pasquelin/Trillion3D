// The occluders' build leaves the culling layer as the occluders' pyramid; the nearest (full) build
// then writes the farthest bound of the FINISHED depth into its own layer, from level 1, beside the
// nearest layer, and the culling layer as the finished depth's pyramid — the reference's one build
// reduces the furthest and the closest depth of the scene depth together
// (`wholeFarthestPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'

test('the finished depth has its own farthest layer, and the culling layer is untouched', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'wholeFarthestPage.ts'),
    'hizWholeFarthest',
  )) as typeof import('./wholeFarthestPage.ts')
  const pageErrors: string[] = []
  const cases = [
    { width: 1, height: 1, seed: 1 },
    { width: 17, height: 33, seed: 2 },
    { width: 200, height: 120, seed: 3 },
    { width: 1920, height: 1080, seed: 4 },
  ]
  const { adapter, mismatches, errors } = await runOnDawn(page.testWholeFarthest, cases, pageErrors)
  console.log(JSON.stringify({ adapter, mismatches }))
  assert.deepEqual([...errors, ...pageErrors], [])
  assert.deepEqual(mismatches, [])
})
