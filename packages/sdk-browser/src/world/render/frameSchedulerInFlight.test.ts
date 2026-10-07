// The loop keeps the CPU and the GPU at work together: frame n+1 is drawn while the GPU still runs
// frame n, never more than `FRAMES_IN_FLIGHT` feedbacks awaited, each consumed once and in order,
// and a still view still pauses at its settle limit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerFrameScheduler, FRAMES_IN_FLIGHT } from './frameScheduler.ts'
import { frameQueue } from './frameQueue.fixture.ts'

/** Every microtask a settled feedback runs is done: the loop's decision is made. */
const decided = () => new Promise(setImmediate)

/** Runs the frames the loop asks, each decided, until it asks none; a loop that never stops fails. */
async function runFrames(frames: ReturnType<typeof frameQueue>) {
  for (let frame = 0; frames.run(); frame++) {
    assert.ok(frame < 1000, 'the loop never stopped')
    await decided()
  }
}

/** A loop over `pending`, drawing into `render`, its frames a queue the test runs. */
function loop(render: () => void, pending: () => Promise<boolean>, progress?: () => number) {
  const frames = frameQueue()
  let limited = 0
  const run = createExplorerFrameScheduler({
    ...{ request: frames.request, cancel: frames.cancel, render, pending, progress },
    error: (error) => assert.fail(String(error)),
    limited: () => void limited++,
  })
  return {
    run,
    frames,
    get limited() {
      return limited
    },
  }
}

/** A GPU running the frames submitted to it in order, one every `pace` browser frames: slower
 *  than the CPU, which draws one a frame. A frame's feedback lands when the GPU finished it. */
function slowGpu(pace: number) {
  const queue: (() => void)[] = []
  let ticks = 0,
    idle = 0
  return {
    queue,
    /** Completions that left the GPU nothing to run. */
    get idle() {
      return idle
    },
    submit: () => new Promise<boolean>((done) => queue.push(() => done(true))),
    tick() {
      if (++ticks % pace || !queue.length) return
      queue.shift()!()
      if (!queue.length) idle++
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
  let browserFrames = 0
  while (t.frames.size || gpu.queue.length) {
    assert.ok(++browserFrames < 1000, 'the loop never stopped')
    t.frames.run()
    gpu.tick()
    await decided()
  }
  assert.equal(renders, 120, 'the still view drew its settle limit, then paused')
  assert.equal(t.limited, 1)
  assert.equal(overlapped, renders - 1, 'each frame after the first is drawn before the last ran')
  assert.equal(deepest, FRAMES_IN_FLIGHT, 'never more frames in flight than K')
  assert.equal(gpu.idle, 1, 'the GPU waits for no frame but after the last')
  // The GPU's time alone: three browser frames a frame, plus the first frame's CPU.
  assert.ok(browserFrames <= 3 * renders + 1, `${browserFrames} browser frames`)
})

test('feedbacks settling out of order are consumed in order, each once, K at most in flight', async () => {
  // A fixed shuffle (a linear congruence): reproducible, every order of two or three met.
  let seed = 7
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647
  const answers: { frame: number; settle: () => void; settled: boolean }[] = []
  let renders = 0
  /** Feedbacks the loop still waits on: those after the oldest one not settled yet. */
  const inFlight = () => {
    const oldest = answers.findIndex((a) => !a.settled)
    return oldest < 0 ? 0 : answers.length - oldest
  }
  const render = () => {
    renders++
    assert.ok(inFlight() < FRAMES_IN_FLIGHT, `frame ${renders} drawn with every feedback awaited`)
  }
  const t = loop(render, () => {
    const frame = renders
    return new Promise<boolean>((resolve) => {
      const answer = { frame, settled: false, settle: () => resolve(frame < 80) }
      answers.push(answer)
    })
  })
  t.run.invalidate()
  for (let turn = 0; turn < 2000 && (t.frames.size || answers.some((a) => !a.settled)); turn++) {
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
  assert.equal(t.frames.size, 0, 'the loop stopped on the newest feedback')
  assert.ok(renders >= 80 && renders < 80 + FRAMES_IN_FLIGHT, `${renders} frames`)
  assert.deepEqual(
    answers.map((a) => a.frame),
    Array.from({ length: renders }, (_, n) => n + 1),
    'one feedback asked per frame drawn',
  )
})

test('an older feedback settling after a newer one is still consumed first', async () => {
  const answers: ((again: boolean) => void)[] = []
  const t = loop(
    () => {},
    () => new Promise((resolve) => answers.push(resolve)),
  )
  t.run.invalidate()
  t.frames.run()
  t.frames.run()
  const [older, newer] = answers
  newer(false)
  await decided()
  assert.equal(t.frames.size, 1, 'the newer stop waits for the older feedback')
  older(true)
  await decided()
  assert.equal(t.frames.size, 0, 'consumed in order, the newer stop has the last word')
})

test('a feedback waiting for its landing holds the loop, and each landing wakes it', async () => {
  let loads = 0,
    renders = 0
  const waits: (() => void)[] = []
  // A residency job of 200 pages: the feedback waits for the next one, then for none.
  const pending = () =>
    loads < 200
      ? new Promise<boolean>((woken) => waits.push(() => woken(true)))
      : Promise.resolve(true)
  const t = loop(
    () => void renders++,
    pending,
    () => loads,
  )
  t.run.invalidate()
  for (let page = 0; page < 200; page++) {
    await runFrames(t.frames)
    assert.equal(waits.length, FRAMES_IN_FLIGHT, 'the loop holds on its feedbacks')
    const drawn = renders
    loads++
    for (const wake of waits.splice(0)) wake()
    await decided()
    assert.ok(t.frames.size, `landing ${page + 1} wakes the loop`)
    assert.equal(renders, drawn)
  }
  await runFrames(t.frames)
  assert.equal(t.limited, 1, 'once nothing arrives, the loop pauses')
  assert.equal(renders, 2 * 200 + 120, 'two frames a landing, then the limit counted from the last')
})
