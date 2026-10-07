// A batch of material chains reduces level by level across its chains (`texture/mipBatch.ts`):
// each chain's levels equal, byte for byte, those it gets reduced alone — colour plain, weighted
// and cut, data, even, odd, wide and tall —, and a chain reduced again alone on the views and
// groups its texture holds (a live picture's refill) gets them again: image class 1.
//
//   node bench/dawn/proofs.ts tests/gpu/texture/mip-batch.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('chains reduced together equal each reduced alone, and again on its held groups', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'mipBatchPage.ts'),
    'mipBatchPage',
  )) as typeof import('./mipBatchPage.ts')
  const cases = page.chainCases()
  const { adapter, results, errors } = await runOnDawn((all) => page.run(all), cases)
  assert.deepEqual(errors, [], `WebGPU errors on ${adapter}`)
  results.forEach(({ batched, alone, again }, n) => {
    assert.ok(alone.length > 1, `${cases[n].name}: a chain`)
    assert.deepEqual(batched, alone, `${cases[n].name}: the batch moved a byte`)
    assert.deepEqual(again, alone, `${cases[n].name}: the held groups moved a byte`)
  })
})
