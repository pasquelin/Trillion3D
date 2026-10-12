// The reflection of a thick toothed body, seen from the mirror behind it, is continuous: a mirror
// wall's rays pass through the body to the front the screen sees, and every one whose exact ray
// meets the body, off its silhouette, shows its colour — not shards of its edges (`bodyPage.ts`).
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/body.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('the mirror shows a thick body whole, never shards of its edges', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'bodyPage.ts'),
    'reflectionBody',
  )) as typeof import('./bodyPage.ts')
  const result = await runOnDawn(page.run, undefined)
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  const { body = 0, bodyHue = 0 } = result
  console.log(JSON.stringify({ body, bodyHue }))
  assert.ok(body > 100, `${body} wall pixels see the body`)
  assert.ok(bodyHue >= 0.9 * body, `${bodyHue} of ${body} show the body's colour`)
})
