// The Hi-Z test and the rest compaction are sized by the partition's count of tested rows, not by
// the rows the table holds: a table of 20 000 rows with a handful tested dispatches a handful of
// workgroups, and the verdicts and the compacted lists are the ones a dispatch over every row
// gives (`testedArgsPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { VERDICT_REJECTED } from '../../../packages/sdk-browser/src/gpu/partition/contract.ts'

const COUNTS = [0, 1, 64, 65, 130]

test('the Hi-Z test and the rest compaction dispatch the work of the tested rows only', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'testedArgsPage.ts'),
    'hizTestedArgs',
  )) as typeof import('./testedArgsPage.ts')
  const pageErrors: string[] = []
  const { adapter, errors, hiz, wideArgs, rest } = await runOnDawn(
    page.testTestedArgs,
    COUNTS,
    pageErrors,
  )
  console.log(
    JSON.stringify({
      adapter,
      hiz: hiz.map(({ tested, args }) => ({ tested, args })),
      rest: rest.args,
    }),
  )
  assert.deepEqual([...errors, ...pageErrors], [])
  for (const { tested, args, flags, whole } of hiz) {
    // One workgroup of 64 threads per 64 tested boxes: nothing of the table's 20 000 rows.
    assert.deepEqual(args, [Math.ceil(tested / 64), 1, 1], `${tested} boxes: arguments`)
    assert.deepEqual(flags, whole, `${tested} boxes: the verdicts of a dispatch over every row`)
    assert.equal(flags.filter((word) => word === VERDICT_REJECTED).length, tested, `${tested}`)
  }
  assert.deepEqual(wideArgs, [65_535, 3, 1], 'a count past one dimension runs in rows')
  // 100 tested rows of at most 2 instances: 4 tiles of 64, the two tested slots up z.
  assert.deepEqual(rest.args, [4, 1, 2])
  for (const [k, expected] of rest.expected.entries()) {
    assert.equal(rest.counts[k], expected.length, `slot ${k}: survivors`)
    assert.deepEqual(rest.survivors[k], expected, `slot ${k}: the survivors, in order`)
  }
})
