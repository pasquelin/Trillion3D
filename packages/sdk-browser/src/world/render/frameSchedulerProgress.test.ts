// A view still streaming is drawn to its last page (#836): the frames after which a page landed
// spend none of the settle limit, which only pauses a loop where nothing arrives any more.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createExplorerFrameScheduler } from './frameScheduler.ts'
import { frameQueue } from './frameQueue.fixture.ts'

test('pages landing keep the loop drawing past the settle limit; it pauses once they stop', async () => {
  const frames = frameQueue()
  let loads = 0,
    renders = 0,
    limited = 0
  const run = createExplorerFrameScheduler({
    request: frames.request,
    cancel: frames.cancel,
    // Three hundred frames, a page landing before each: a stream longer than the limit.
    render: () => void (++renders <= 300 && loads++),
    pending: async () => true,
    error: (error) => assert.fail(String(error)),
    limited: () => void limited++,
    progress: () => loads,
  })
  run.invalidate()
  while (frames.run()) await new Promise(setImmediate)
  assert.equal(loads, 300, 'every page of the stream was drawn')
  assert.equal(renders, 300 + 120, 'then the limit, counted from the last landing')
  assert.equal(limited, 1)
})
