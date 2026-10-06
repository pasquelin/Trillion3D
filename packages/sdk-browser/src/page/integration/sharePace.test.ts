import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { createSharePace } from './frameBudget.ts'
import { stubPage } from '../../world/render/frameQueue.fixture.ts'

// A page hidden while the pace waits for a frame gets none: the wait ends there, never stalls (#983).
test('a page hidden while a share waits for its frame opens it without one', async () => {
  const page = stubPage('visible')
  try {
    let opened = 0
    const next = createSharePace(() => opened++, 1)
    await next()
    assert.equal(opened, 1, 'the first share after a task')
    let done = false
    const waiting = next().then(() => (done = true))
    await new Promise(setImmediate)
    assert.equal(done, false, 'the second waits for a frame that does not come')
    page.document.visibilityState = 'hidden'
    for (const listener of [...page.listeners]) listener()
    await waiting
    assert.equal(opened, 2)
    assert.equal(page.listeners.size, 0, 'the wait left no listener')
    assert.equal(page.frames.size, 0, 'nor a frame asked')
  } finally {
    page.restore()
  }
})

test('a share a frame lets through opens in a task after it, never inside its callbacks', async () => {
  const page = stubPage('visible')
  try {
    let opened = 0
    const next = createSharePace(() => opened++, 1)
    await next()
    const waiting = next()
    await new Promise(setImmediate)
    assert.ok(page.frames.run(), 'the frame the pace waits for')
    // The frame's callback and every microtask it queued have run: no share opened in them.
    for (let i = 0; i < 20; i++) await Promise.resolve()
    assert.equal(opened, 1, 'no share ahead of the render')
    await waiting
    assert.equal(opened, 2)
  } finally {
    page.restore()
  }
})

test('a visible page whose frames stop loads a share per task until a frame comes again', async () => {
  const page = stubPage('visible')
  try {
    let opened = 0
    const next = createSharePace(() => opened++, 1)
    await next()
    const waiting = next()
    await new Promise(setImmediate)
    assert.equal(opened, 1, 'waits for the frame')
    mock.timers.tick(100)
    await waiting
    // Five shares, each given its task: none waits for a frame that does not come.
    void Promise.all(Array.from({ length: 5 }, next))
    for (let task = 0; task < 20 && opened < 7; task++) await new Promise(setImmediate)
    assert.equal(opened, 7, 'no frame waited for once none came')
    assert.ok(page.frames.run(), 'a frame comes again')
    await new Promise(setImmediate)
    await next()
    let done = false
    const paced = next().then(() => (done = true))
    await new Promise(setImmediate)
    assert.equal(done, false, 'paced by frames again')
    assert.ok(page.frames.run())
    await paced
    assert.equal(opened, 9)
  } finally {
    page.restore()
  }
})
