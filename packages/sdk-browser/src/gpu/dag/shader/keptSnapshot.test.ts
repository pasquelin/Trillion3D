// The kept snapshot and the regions the views aside save lie where the host lays them, a word an
// entry: the kernel's own functions run in Node (`wgslScope`) against the host's words — a stride
// of its own would write the kept lists over what the host keeps behind them (`heldOpen.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { wgslScope } from '../../../page/cut/wgslPredicate.fixture.ts'
import { wgslConstants } from '../../../texture/shaderRule.fixture.ts'
import {
  KEPT_HEADER_WORDS,
  SELECTION_HEADER_WORDS,
  savedJournalWord,
  keptSnapshotWord,
} from '../layout.ts'

/** The kernel's readout functions for a list of `listCap` ranks. */
function kernel(listCap: number) {
  const scope = wgslScope(DAG_SELECTION_SHADER, {
    ...wgslConstants(DAG_SELECTION_SHADER),
    views: [{ listCap }],
  })
  const fn = (name: string) => scope.fn(name) as (...args: number[]) => number
  return { keptAt: fn('keptAt'), savedAt: fn('savedAt') }
}

test('the kept snapshot and the saved journals lie where the host lays them, a word an entry', () => {
  for (const cap of [1, 64, 1000, 262144]) {
    const k = kernel(cap),
      at = keptSnapshotWord(cap)
    // `out.pages` starts behind the header: the kernel's word `w` is the readout's `SELECTION_HEADER_WORDS + w`.
    for (const w of [
      0,
      1,
      KEPT_HEADER_WORDS,
      KEPT_HEADER_WORDS + cap,
      KEPT_HEADER_WORDS + 2 * cap - 1,
    ])
      assert.equal(k.keptAt(w) + SELECTION_HEADER_WORDS, at + w, `list of ${cap}, kept word ${w}`)
    // Behind the regions the views aside save, the open counts the host writes (`heldOpen.ts`).
    for (const regions of [0, 1, 3])
      assert.equal(
        k.savedAt(regions) + SELECTION_HEADER_WORDS,
        savedJournalWord(cap, regions),
        `${regions} regions`,
      )
  }
})
