// A tick the engine leaves out under its frame cap (`skip`) is no frame: on a fake display whose
// ticks the test runs, a loop skipping every other tick draws on the others alone and asks no
// feedback in a skipped one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDisplay } from './frameQueue.fixture.ts'

test('a loop skipping every other tick draws on the others alone', async () => {
  for (const late of [1, 3]) {
    const ticks = 200
    const r = await fakeDisplay({ late, ticks, skip: (tick) => tick % 2 === 1 })
    r.askedAt.forEach((asked, at) => {
      if ((at + 1) % 2 === 1)
        assert.equal(asked, 0, `tick ${at + 1}: a skipped tick asked a feedback`)
    })
    assert.equal(r.drawnAt.length, ticks / 2, `late ${late}`)
    for (let i = 0; i < ticks / 2; i++)
      assert.equal(r.drawnAt[i], 2 * (i + 1), `frame ${i} on tick ${2 * (i + 1)}`)
  }
})
