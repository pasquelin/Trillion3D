import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerFrameScheduler } from './frameScheduler.ts'
import { frameQueue } from './frameQueue.fixture.ts'

function fixture(pending = async () => false) {
  const frames = frameQueue()
  const errors: unknown[] = []
  let renders = 0,
    limited = 0
  const scheduler = createExplorerFrameScheduler({
    request: frames.request,
    cancel: frames.cancel,
    render: () => {
      renders++
    },
    pending,
    error: (error) => {
      errors.push(error)
    },
    limited: () => {
      limited++
    },
  })
  return {
    ...scheduler,
    frames,
    errors,
    get renders() {
      return renders
    },
    get limited() {
      return limited
    },
    async frame() {
      assert.ok(frames.run())
      await new Promise(setImmediate)
    },
  }
}

test('input coalesces, pending work advances, and a settled scene schedules nothing', async () => {
  let remaining = 3
  const run = fixture(async () => --remaining > 0)
  run.invalidate()
  run.invalidate()
  assert.equal(run.frames.size, 1)
  for (let i = 0; i < 3; i++) await run.frame()
  assert.equal(run.renders, 3)
  assert.equal(run.frames.size, 0)
})

test('a slow asynchronous wait does not prevent camera input from rendering', async () => {
  let finish!: (value: boolean) => void
  const run = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  run.invalidate()
  await run.frame()
  // The frame asked right after it is drawn while the first one's feedback is still awaited.
  await run.frame()
  assert.equal(run.renders, 2)
  // The next comes with both feedbacks in flight: held, nothing drawn.
  await run.frame()
  assert.equal(run.renders, 2)
  assert.equal(run.frames.size, 0)
  run.invalidate()
  await run.frame()
  assert.equal(run.renders, 3)
  run.dispose()
  finish(true)
  await new Promise(setImmediate)
  assert.equal(run.frames.size, 0)
})

test('disposal cancels a queued frame and rendering errors stop the scheduler', async () => {
  const run = fixture(async () => {
    throw Error('device lost')
  })
  run.invalidate()
  await run.frame()
  assert.match(String(run.errors[0]), /device lost/)
  run.invalidate()
  assert.equal(run.frames.size, 0)
  const queued = fixture()
  queued.invalidate()
  queued.dispose()
  assert.equal(queued.frames.size, 0)
})

test('unsettled work has a published finite bound and a new input resumes it', async () => {
  const run = fixture(async () => true)
  run.invalidate()
  for (let i = 0; i < 120; i++) await run.frame()
  assert.equal(run.frames.size, 0)
  assert.equal(run.limited, 1)
  run.invalidate()
  await run.frame()
  assert.equal(run.renders, 121)
  run.dispose()
})

/** A loop whose every feedback waits for the test's answer. */
function manual() {
  const answers: ((again: boolean) => void)[] = []
  const run = fixture(() => new Promise<boolean>((resolve) => answers.push(resolve)))
  return { run, answers }
}

test('the next frame is asked right after render, and a stop cancels it', async () => {
  const { run, answers } = manual()
  run.invalidate()
  await run.frame()
  assert.equal(run.frames.size, 1, 'asked before the feedback lands')
  answers.shift()!(false)
  await new Promise(setImmediate)
  assert.equal(run.frames.size, 0, 'a settled scene cancels it')
  assert.equal(run.renders, 1)
})

test('a stale idle answer cannot strand work submitted by a newer camera input', async () => {
  const { run, answers } = manual()
  run.invalidate()
  await run.frame()
  await run.frame()
  // Both feedbacks in flight: a camera input still draws at once, and asks none.
  run.invalidate()
  await run.frame()
  assert.equal(run.renders, 3)
  answers.shift()!(false)
  answers.shift()!(false)
  await new Promise(setImmediate)
  assert.equal(run.frames.size, 1, 'the newer frame still needs its feedback drained')
  run.dispose()
})

test('a held frame moves no revision: a stop answered after it pauses the loop', async () => {
  const { run, answers } = manual()
  run.invalidate()
  await run.frame()
  await run.frame()
  // Both feedbacks in flight: the third frame is held.
  await run.frame()
  assert.equal(run.renders, 2)
  answers.shift()!(false)
  answers.shift()!(false)
  await new Promise(setImmediate)
  assert.equal(run.frames.size, 0)
  assert.equal(run.renders, 2)
})
