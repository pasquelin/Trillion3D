// A tick the engine leaves out of its steady cadence (`skip`) is no frame: on a fake display whose
// ticks the test runs, a loop skipping every other tick draws on the others alone, asks no
// feedback in a skipped one, spends no settle round in it, and still stops exactly at the limit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDisplay } from './frameQueue.fixture.ts'
import { SETTLE_LIMIT } from './frameScheduler.ts'

test('a loop skipping every other tick draws on the others, its limit counted in frames drawn', async () => {
  for (const late of [1, 3]) {
    const r = await fakeDisplay({
      late,
      ticks: 2 * SETTLE_LIMIT + 10 * late + 20,
      skip: (tick) => tick % 2 === 1,
    })
    r.askedAt.forEach((asked, at) => {
      if ((at + 1) % 2 === 1)
        assert.equal(asked, 0, `tick ${at + 1}: a skipped tick asked a feedback`)
    })
    const drawn = r.drawnAt.length
    assert.equal(drawn, SETTLE_LIMIT, `late ${late}: ${drawn} frames`)
    assert.ok(
      r.drawnAt.every((at) => at % 2 === 0),
      'drawn on the kept ticks alone',
    )
    for (let i = 0; i < SETTLE_LIMIT; i++)
      assert.equal(r.drawnAt[i], 2 * (i + 1), `frame ${i} on tick ${2 * (i + 1)}`)
    assert.equal(r.limited, 1)
    assert.equal(r.frames.size, 0)
  }
})
