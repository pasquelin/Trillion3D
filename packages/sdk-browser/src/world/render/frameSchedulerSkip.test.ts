// A tick the engine leaves out of its steady cadence (`skip`) is no frame: on a fake display whose
// ticks the test runs, a loop skipping every other tick draws on the others alone, asks no
// feedback in a skipped one, spends no settle round in it, and still stops exactly at the limit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerFrameScheduler } from './frameScheduler.ts'
import { frameQueue } from './frameQueue.fixture.ts'

const decided = () => new Promise(setImmediate)
const LIMIT = 120

test('a loop skipping every other tick draws on the others, its limit counted in frames drawn', async () => {
  for (const late of [1, 3]) {
    const frames = frameQueue()
    const open: { due: number; done: () => void }[] = []
    let tick = 0,
      drawn = 0,
      asked = 0,
      limited = 0
    const drawnAt: number[] = []
    const run = createExplorerFrameScheduler({
      request: frames.request,
      cancel: frames.cancel,
      render: () => {
        drawn++
        drawnAt.push(tick)
      },
      pending: () => {
        asked++
        return new Promise<boolean>((done) =>
          open.push({ due: tick + late, done: () => done(true) }),
        )
      },
      error: (error) => assert.fail(String(error)),
      limited: () => void limited++,
      skip: () => tick % 2 === 1,
    })
    run.invalidate()
    for (tick = 1; tick <= 2 * LIMIT + 10 * late + 20; tick++) {
      const before = asked
      frames.run()
      if (tick % 2 === 1)
        assert.equal(asked, before, `tick ${tick}: a skipped tick asked a feedback`)
      while (open.length && open[0].due <= tick) open.shift()!.done()
      await decided()
    }
    assert.equal(drawn, LIMIT, `late ${late}: ${drawn} frames`)
    assert.ok(
      drawnAt.every((at) => at % 2 === 0),
      'drawn on the kept ticks alone',
    )
    for (let i = 0; i < LIMIT; i++)
      assert.equal(drawnAt[i], 2 * (i + 1), `frame ${i} on tick ${2 * (i + 1)}`)
    assert.equal(limited, 1)
    assert.equal(frames.size, 0)
  }
})
