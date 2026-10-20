// The loop is paced by the display alone: on a fake display whose ticks the test runs, feedbacks
// settling 1, 2, 3 and 10 ticks late, the loop draws on every tick, never twice in one, and never
// asks more feedbacks than slots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDisplay } from './frameQueue.fixture.ts'

for (const late of [1, 2, 3, 10])
  test(`feedbacks ${late} ticks late: every tick draws one frame`, async () => {
    const r = await fakeDisplay({ late, ticks: 300 })
    for (let t = 0; t < 300; t++) assert.equal(r.drawn[t], 1, `tick ${t + 1} drew nothing`)
    assert.equal(r.frames.size, 1, 'the next tick is asked')
  })
