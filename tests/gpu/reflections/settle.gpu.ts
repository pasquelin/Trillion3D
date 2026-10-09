// A view that stands still is held only when its reflections are final (`reflectionsSettled`,
// `reflections/settle.ts`): the light changes with the camera still, the image drawn for the change
// reflects the lit image before it, and the view is not settled until a lit image repeats. The image
// it then holds is the cold converged image — the one a view that never saw the first light
// converges to — to the bit (`settlePage.ts`).
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/settle.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('a light changed with the camera still holds the cold converged image, bit for bit', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'settlePage.ts'),
    'reflectionSettle',
  )) as typeof import('./settlePage.ts')
  const result = await runOnDawn(page.run, undefined)
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  const { first, lagging, changed, cold } = result
  console.log(
    JSON.stringify({ first: first!.images, changed: changed!.images, cold: cold!.images }),
  )
  assert.ok(changed!.images >= 2, `settled after ${changed!.images} images drawn for the change`)
  assert.notDeepEqual(changed!.target, first!.target, 'the held image shows the new light')
  assert.notDeepEqual(lagging, cold!.target, 'the image drawn for the change reflects the old one')
  assert.deepEqual(changed!.target, cold!.target, 'the held image is the cold converged one')
})
