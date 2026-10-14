// A camera cut on a small binding cuts on the GPU as the whole cut does: the shipped kernels and
// resources, the device the engine opens, and that same device reporting a binding two thirds of
// the placements' frame words hold (`frameRangesPage.ts`). Once refused — its tables in parts, 12
// storage bindings past a stage's 10 —, the device is accepted now: every table is a record table,
// the stage binds the readout and `work` alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('a cut past one binding cuts as the whole cut, on the GPU', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'frameRangesPage.ts'),
    'frameRanges',
  )) as typeof import('./frameRangesPage.ts')
  const pageErrors: string[] = []
  const { adapter, storageBindings, refusal, errors, whole, split } = await runOnDawn(
    page.cutWholeAndSplit,
    [0.25, 0.5, 2],
    pageErrors,
  )
  console.log(
    JSON.stringify({
      adapter,
      storageBindings,
      storage: split?.storage,
      drawn: whole?.cuts.map(({ pageIds }) => pageIds.length),
    }),
  )
  assert.deepEqual([...errors, ...pageErrors], [])
  assert.equal(refusal, undefined, 'the engine accepts the narrow device')
  assert.ok(whole && split, 'the cut does not mount')
  assert.equal(split.storage, 2, 'the stage binds the readout and `work` alone')
  for (const [k, cut] of whole.cuts.entries()) {
    assert.ok(cut.pageIds.length > 0, `the scene draws at ${cut.pixelError} px`)
    assert.ok(cut.frustumRejected > 0, 'some of it lies outside the view')
    assert.deepEqual(split.cuts[k], cut, `the same cut at ${cut.pixelError} px`)
  }
})
