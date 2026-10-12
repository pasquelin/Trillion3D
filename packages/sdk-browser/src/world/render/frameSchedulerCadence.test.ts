// The loop is paced by the display alone: on a fake display whose ticks the test runs, feedbacks
// settling 1, 2, 3 and 10 ticks late and pages landing every N ticks, a loop with work draws on
// every tick, never twice in one, never asks more feedbacks than slots, and stops exactly at the
// settle rule; a still view still holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerFrameScheduler } from './frameScheduler.ts'
import { frameQueue } from './frameQueue.fixture.ts'
import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'

const decided = () => new Promise(setImmediate)
const LIMIT = 120

/** A display of `ticks` refreshes: each runs the frame the loop asked, then settles the feedbacks
 *  whose lateness is up. A page lands every `every` ticks while `pages` remain. */
async function display(late: number, every: number, pages: number, ticks: number) {
  const frames = frameQueue()
  const open: { due: number }[] = []
  const resolvers: (() => void)[] = []
  let tick = 0,
    landed = 0,
    drawnThisTick = 0,
    asked = 0,
    limited = 0
  const drawn: number[] = [],
    idleTicks: number[] = []
  const run = createExplorerFrameScheduler({
    request: frames.request,
    cancel: frames.cancel,
    render: () => {
      drawnThisTick++
      if (landed < pages && tick % every === 0) landed++
    },
    pending: () => {
      assert.ok(open.length < DAG_READBACK_SLOTS, 'a feedback asked with every slot taken')
      asked++
      open.push({ due: tick + late })
      return new Promise<boolean>((done) => resolvers.push(() => done(true)))
    },
    progress: () => landed,
    arriving: () => false,
    error: (error) => assert.fail(String(error)),
    limited: () => void limited++,
  })
  run.invalidate()
  for (tick = 1; tick <= ticks; tick++) {
    drawnThisTick = 0
    const had = frames.size > 0
    frames.run()
    assert.ok(drawnThisTick <= 1, 'drawn twice in one tick')
    drawn.push(drawnThisTick)
    if (!had) idleTicks.push(tick)
    while (open.length && open[0].due <= tick) {
      open.shift()
      resolvers.shift()!()
    }
    await decided()
  }
  return { drawn, idleTicks, asked, limited, frames, landed }
}

for (const late of [1, 2, 3, 10])
  test(`feedbacks ${late} ticks late: every tick draws while pages arrive, then the limit stops it`, async () => {
    const pages = 300
    const r = await display(late, 1, pages, pages + LIMIT + 4 * late + 20)
    for (let t = 0; t < pages; t++) assert.equal(r.drawn[t], 1, `tick ${t + 1} drew nothing`)
    const total = r.drawn.reduce((a, b) => a + b, 0)
    assert.equal(r.limited, 1)
    assert.equal(r.frames.size, 0)
    assert.ok(Math.abs(total - pages - LIMIT) <= 2, `${total} frames`)
  })

for (const late of [1, 3, 10])
  test(`feedbacks ${late} late, a page every 7 ticks: no tick skipped while they arrive`, async () => {
    const r = await display(late, 7, 40, 7 * 40 + LIMIT + 60)
    for (let t = 0; t < 7 * 40; t++) assert.equal(r.drawn[t], 1, `tick ${t + 1} drew nothing`)
    assert.equal(r.limited, 1)
  })

test('a still view draws its limit, one frame a tick whatever the lateness, then holds', async () => {
  for (const late of [1, 2, 3, 10]) {
    const r = await display(late, 1, 0, LIMIT + 5 * late + 10)
    const total = r.drawn.reduce((a, b) => a + b, 0)
    assert.equal(total, LIMIT, `late ${late}: ${total} frames`)
    for (let t = 0; t < LIMIT; t++) assert.equal(r.drawn[t], 1)
    assert.equal(r.limited, 1)
    assert.equal(r.frames.size, 0)
  }
})
