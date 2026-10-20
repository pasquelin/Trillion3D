// The loop keeps the CPU and the GPU at work together: frame n+1 is drawn while the GPU still runs
// frame n, never more than `FRAMES_IN_FLIGHT` feedbacks awaited, each consumed once and in order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerFrameScheduler } from './frameScheduler.ts'
import { decided, frameQueue } from './frameQueue.fixture.ts'
import { DAG_READBACK_SLOTS } from '../../geometry/dag/layout.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** The scheduler's `FRAMES_IN_FLIGHT`: the cut's readback slots. */
const FRAMES_IN_FLIGHT = DAG_READBACK_SLOTS

/** A loop over `pending`, drawing into `render`, its frames a queue the test runs. */
function loop(render: () => void, pending: () => Promise<unknown>) {
  const frames = frameQueue()
  const run = createExplorerFrameScheduler({
    ...{ request: frames.request, cancel: frames.cancel, render, pending },
    error: (error) => assert.fail(String(error)),
  })
  return { run, frames }
}

/** A GPU running the frames submitted to it in order, one every `pace` browser frames: slower
 *  than the CPU, which draws one a frame. A frame's feedback lands when the GPU finished it. */
function slowGpu(pace: number) {
  const queue: (() => void)[] = []
  let ticks = 0
  return {
    queue,
    submit: () => new Promise<boolean>((done) => queue.push(() => done(true))),
    tick() {
      if (++ticks % pace || !queue.length) return
      queue.shift()!()
    },
  }
}

test('a GPU slower than the CPU always has the next frame queued, never more than K', async () => {
  const gpu = slowGpu(3)
  let renders = 0,
    overlapped = 0,
    deepest = 0
  const render = () => {
    renders++
    if (gpu.queue.length) overlapped++
  }
  const t = loop(render, () => {
    const feedback = gpu.submit()
    deepest = Math.max(deepest, gpu.queue.length)
    return feedback
  })
  t.run.invalidate()
  for (let browserFrames = 0; browserFrames < 300; browserFrames++) {
    t.frames.run()
    gpu.tick()
    await decided()
  }
  assert.equal(renders, 300, 'one frame a browser frame')
  assert.equal(overlapped, renders - 1, 'each frame after the first is drawn before the last ran')
  assert.equal(deepest, FRAMES_IN_FLIGHT, 'never more frames in flight than K')
  t.run.dispose()
})

test('feedbacks settling out of order are consumed in order, each once, K at most in flight', async () => {
  // A fixed shuffle (a linear congruence): reproducible, every order of two or three met.
  const random = lcgRandom(7)
  const answers: { frame: number; settle: () => void; settled: boolean }[] = []
  let renders = 0
  /** Feedbacks the loop still waits on: those after the oldest one not settled yet. */
  const inFlight = () => {
    const oldest = answers.findIndex((a) => !a.settled)
    return oldest < 0 ? 0 : answers.length - oldest
  }
  const render = () => void renders++
  const t = loop(render, () => {
    assert.ok(inFlight() < FRAMES_IN_FLIGHT, 'a feedback asked with every slot taken')
    const frame = renders
    return new Promise<boolean>((resolve) => {
      const answer = { frame, settled: false, settle: () => resolve(true) }
      answers.push(answer)
    })
  })
  t.run.invalidate()
  for (let turn = 0; turn < 400; turn++) {
    t.frames.run()
    const open = answers.filter((a) => !a.settled)
    // Settles any of them, the newer ones first as often as not.
    for (const answer of open.sort(() => random() - 0.5))
      if (random() < 0.5) {
        answer.settled = true
        answer.settle()
      }
    await decided()
  }
  assert.equal(renders, 400, 'a frame every turn, whatever the feedbacks do')
  assert.deepEqual(
    answers.map((a) => a.frame),
    [...new Set(answers.map((a) => a.frame))].sort((x, y) => x - y),
    'a feedback asked per frame at most, each frame its own',
  )
  t.run.dispose()
})

test('an older feedback settling after a newer one is still consumed first', async () => {
  const answers: ((value: boolean) => void)[] = []
  let asked = 0
  const t = loop(
    () => {},
    () => (asked++, new Promise((resolve) => answers.push(resolve))),
  )
  t.run.invalidate()
  t.frames.run()
  t.frames.run()
  const [older, newer] = answers
  newer(true)
  await decided()
  t.frames.run()
  assert.equal(asked, 2, 'the newer one settled, the older not: both slots still taken')
  older(true)
  await decided()
  t.frames.run()
  assert.equal(asked, 3, 'consumed in order, both slots freed')
  t.run.dispose()
})
