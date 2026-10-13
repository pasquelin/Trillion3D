// The loop is paced by the display alone: on a fake display whose ticks the test runs, feedbacks
// settling 1, 2, 3 and 10 ticks late and pages landing every N ticks, a loop with work draws on
// every tick, never twice in one, never asks more feedbacks than slots, and stops exactly at the
// settle rule; a still view still holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDisplay } from './frameQueue.fixture.ts'
import { SETTLE_LIMIT } from './frameScheduler.ts'

for (const late of [1, 2, 3, 10])
  test(`feedbacks ${late} ticks late: every tick draws while pages arrive, then the limit stops it`, async () => {
    const pages = 300
    const r = await fakeDisplay({ late, pages, ticks: pages + SETTLE_LIMIT + 4 * late + 20 })
    for (let t = 0; t < pages; t++) assert.equal(r.drawn[t], 1, `tick ${t + 1} drew nothing`)
    const total = r.drawn.reduce((a, b) => a + b, 0)
    assert.equal(r.limited, 1)
    assert.equal(r.frames.size, 0)
    assert.ok(Math.abs(total - pages - SETTLE_LIMIT) <= 2, `${total} frames`)
  })

for (const late of [1, 3, 10])
  test(`feedbacks ${late} late, a page every 7 ticks: no tick skipped while they arrive`, async () => {
    const r = await fakeDisplay({ late, every: 7, pages: 40, ticks: 7 * 40 + SETTLE_LIMIT + 60 })
    for (let t = 0; t < 7 * 40; t++) assert.equal(r.drawn[t], 1, `tick ${t + 1} drew nothing`)
    assert.equal(r.limited, 1)
  })

test('a still view draws its limit, one frame a tick whatever the lateness, then holds', async () => {
  for (const late of [1, 2, 3, 10]) {
    const r = await fakeDisplay({ late, ticks: SETTLE_LIMIT + 5 * late + 10 })
    const total = r.drawn.reduce((a, b) => a + b, 0)
    assert.equal(total, SETTLE_LIMIT, `late ${late}: ${total} frames`)
    for (let t = 0; t < SETTLE_LIMIT; t++) assert.equal(r.drawn[t], 1)
    assert.equal(r.limited, 1)
    assert.equal(r.frames.size, 0)
  }
})
