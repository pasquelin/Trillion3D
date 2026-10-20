import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerFrameScheduler } from './frameScheduler.ts'
import { frameQueue } from './frameQueue.fixture.ts'

function fixture(pending: () => Promise<unknown> = async () => undefined) {
  const frames = frameQueue()
  const errors: unknown[] = []
  let renders = 0
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
  })
  return {
    ...scheduler,
    frames,
    errors,
    get renders() {
      return renders
    },
    async frame() {
      assert.ok(frames.run())
      await new Promise(setImmediate)
    },
  }
}

test('input coalesces, and the loop draws on every tick, a settled image included', async () => {
  const run = fixture()
  run.invalidate()
  run.invalidate()
  assert.equal(run.frames.size, 1)
  for (let i = 0; i < 200; i++) await run.frame()
  assert.equal(run.renders, 200, 'never paused: every frame is drawn')
  assert.equal(run.frames.size, 1)
  run.dispose()
})

test('a slow asynchronous wait does not prevent the next frames from drawing', async () => {
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
  // The next comes with both feedbacks in flight: drawn all the same, asking none.
  await run.frame()
  assert.equal(run.renders, 3)
  assert.equal(run.frames.size, 1)
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
