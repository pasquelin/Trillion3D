// Each kept list's ranks live in a table the readout's list bounds, never the pages: on the GPU, the
// difference the shipped kernels take of each snapshot is the map's, rank for rank, against the
// snapshot before it — empty first, repeats included, at the table's full load, and across a
// readout grown, its kept lists ranked again in the new tables (`keptRanksPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { differenceOf } from '../../../packages/sdk-browser/src/gpu/dag/difference.fixture.ts'
import { keptRankRow } from '../../../packages/sdk-browser/src/gpu/dag/keptRanks.ts'

test('the kept ranks a table of the list holds give the difference the map gives', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'keptRanksPage.ts'),
    'keptRanks',
  )) as typeof import('./keptRanksPage.ts')
  const pageErrors: string[] = []
  const { adapter, errors, pages, grown, rankBytes, snapshots } = await runOnDawn(
    page.keptRankDifferences,
    [],
    pageErrors,
  )
  console.log(JSON.stringify({ adapter, pages, rankBytes }))
  assert.deepEqual([...errors, ...pageErrors], [])
  assert.ok(grown, 'the readout grows')
  // The grown tables follow the list, and the catalogue's pages no more than before.
  assert.deepEqual(
    rankBytes,
    [0, 1].map((l) => keptRankRow(l, 256).size),
  )
  let named = 0
  snapshots.forEach(({ lists, got }, k) => {
    const before = snapshots[k - 1]?.lists ?? [[], []]
    for (const l of [0, 1]) {
      const expected = Array.from(differenceOf(lists[l], before[l]))
      // A repeated page is named at one of its ranks: any rank the kept list holds it at.
      got[l].forEach((rank, s) => {
        if (rank === expected[s]) return
        assert.equal(
          before[l][rank],
          lists[l][s],
          `snapshot ${k}, list ${l}, rank ${s}: ${JSON.stringify([got[l].slice(0, 20), expected.slice(0, 20), before[l].slice(0, 20), lists[l].slice(0, 20)])}`,
        )
      })
      assert.deepEqual(
        got[l].map((rank) => rank === 0xffffffff),
        expected.map((rank) => rank === 0xffffffff),
        `snapshot ${k}, list ${l}: the same pages kept`,
      )
      named += expected.filter((rank) => rank !== 0xffffffff).length
    }
  })
  assert.ok(named > 100, `only ${named} ranks named: the proof covers nothing`)
})
