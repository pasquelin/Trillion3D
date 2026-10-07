// A camera cut split on a small binding cuts on the GPU as the whole cut does: the shipped
// kernels and resources, the device the engine opens, and that same device reporting a binding
// half the primitives' `frames` — two ranges of `frames`, its tables in parts
// (`frameRangesPage.ts`). The engine's own device check must accept the split device first: a
// device it refuses draws with the CPU cut, and proves nothing here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('a cut in two ranges and table parts cuts as the whole cut, on the GPU', async () => {
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
      split: split && [split.ranges, split.parts],
      drawn: whole?.cuts.map(({ pageIds }) => pageIds.length),
    }),
  )
  assert.deepEqual([...errors, ...pageErrors], [])
  assert.equal(refusal, undefined, 'the engine refuses the split device: the adapter binds too few')
  assert.ok(whole && split, 'the cut does not mount')
  assert.equal(whole.ranges, 1)
  assert.equal(split.ranges, 2, '`frames` splits in two ranges')
  assert.ok(split.parts.nodes > 1 && split.parts.flags > 1, 'the tables split in parts')
  for (const [k, cut] of whole.cuts.entries()) {
    assert.ok(cut.pageIds.length > 0, `the scene draws at ${cut.pixelError} px`)
    assert.ok(cut.frustumRejected > 0, 'some of it lies outside the view')
    assert.deepEqual(split.cuts[k], cut, `the same cut at ${cut.pixelError} px`)
  }
})
