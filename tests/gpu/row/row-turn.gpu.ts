// R2 (#1527): a view slides across many placements of one primitive on Dawn, its rows a cache far
// smaller than the instances, every row taken back on the GPU's word (`rowTurnPage.ts`): the
// closure stamps each placement's own rows from the cut's whole lists, the sort ranks them, the
// queue rides the readback. Every frame the cut covers what a table holding everything covers —
// the nearest ready ancestor where a row is missing, never a hole —; no row is taken from a page a
// landed cut used less than `ROW_IN_USE` frames before; settled, the cut is the whole table's.
// What it publishes for the recette to hold against the CPU clock it replaced: the requests denied,
// the frames to settle, the rows taken back, and those a cut not yet read back still used.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'

type Reading = Awaited<ReturnType<typeof import('./rowTurnPage.ts').runRowTurn>>

test('a view sliding past the table: no hole, no row in use taken, settled whole', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'rowTurnPage.ts'),
    'rowTurn',
    'runRowTurn',
  )) as Reading
  assertSoundProof(reading)
  assert.ok('frames' in reading && reading.frames, String(reading))
  const { frames, denied, taken, takenInUse, flight } = reading
  const settledAt = frames.findIndex(
    (f, at) =>
      f.frame > flight && frames.slice(at).every((g) => g.drawn.join() === g.reference.join()),
  )
  console.log(
    JSON.stringify({
      adapter: reading.adapter,
      landed: frames.length,
      denied,
      taken: taken.length,
      settledAfter: settledAt < 0 ? null : frames[settledAt].frame - flight,
    }),
  )
  assert.ok(taken.length > 0, 'the slide takes rows back')
  for (const f of frames)
    assert.equal(f.holes, 0, `frame ${f.frame}: a leaf the table covers left uncovered`)
  assert.deepEqual(takenInUse, [], 'no row taken from a page a landed cut used within the span')
  const last = frames.at(-1)!
  assert.deepEqual(last.drawn, last.reference, 'settled, the cut is the whole table’s')
})
