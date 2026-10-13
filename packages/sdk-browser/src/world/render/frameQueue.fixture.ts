import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createExplorerFrameScheduler } from './frameScheduler.ts'
import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'
/** A browser frame queue that runs nothing by itself: the test runs what was asked, oldest first,
 *  and a cancel takes its frame out, as `cancelAnimationFrame` does. */
export function frameQueue() {
  const frames = new Map<number, FrameRequestCallback>()
  let next = 0
  return {
    request: (callback: FrameRequestCallback) => (frames.set(++next, callback), next),
    cancel: (id: number) => void frames.delete(id),
    get size() {
      return frames.size
    },
    /** Runs the oldest frame asked; false when none is. */
    run() {
      const entry = frames.entries().next().value
      if (!entry) return false
      frames.delete(entry[0])
      entry[1](0)
      return true
    },
  }
}

/** A page in `visibility` on the globals: its frames a `frameQueue` the test runs, its
 *  `visibilitychange` listeners kept, its timers held so no frame wait times out by itself;
 *  `restore` takes it all away. */
export function stubPage(visibility: DocumentVisibilityState) {
  const frames = frameQueue(),
    listeners = new Set<() => void>(),
    host = globalThis as Record<string, unknown>
  const document = {
    visibilityState: visibility,
    addEventListener: (_: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => void listeners.delete(listener),
  }
  const stubs = {
    document,
    requestAnimationFrame: frames.request,
    cancelAnimationFrame: frames.cancel,
  }
  Object.assign(host, stubs)
  mock.timers.enable({ apis: ['setTimeout'] })
  const restore = () => {
    mock.timers.reset()
    for (const key of Object.keys(stubs)) delete host[key]
  }
  return { frames, document, listeners, restore }
}

/** One turn of the event loop: what the frames' feedbacks decided has run. */
export const decided = () => new Promise(setImmediate)

/** What a fake display runs (`fakeDisplay`): feedbacks settling `late` ticks after they are asked,
 *  a page landing every `every` ticks while `pages` remain, `ticks` refreshes, and the ticks the
 *  engine leaves out of its cadence (`skip`). */
export type DisplayRun = {
  late: number
  ticks: number
  every?: number
  pages?: number
  skip?: (tick: number) => boolean
}

/**
 * A display of `ticks` refreshes the test runs: each runs the frame the loop asked, then settles
 * the feedbacks whose lateness is up. It never asks more feedbacks than slots, never draws twice in
 * a tick, and returns what each tick drew, the ticks with no frame asked, the ticks drawn on, the
 * feedbacks each tick asked, the feedbacks and limits counted, the queue and the pages landed.
 */
export async function fakeDisplay({ late, ticks, every = 1, pages = 0, skip }: DisplayRun) {
  const frames = frameQueue()
  const open: { due: number; done: () => void }[] = []
  let tick = 0,
    landed = 0,
    drawnThisTick = 0,
    asked = 0,
    limited = 0
  const drawn: number[] = [],
    drawnAt: number[] = [],
    askedAt: number[] = [],
    idleTicks: number[] = []
  const run = createExplorerFrameScheduler({
    request: frames.request,
    cancel: frames.cancel,
    render: () => {
      drawnThisTick++
      drawnAt.push(tick)
      if (landed < pages && tick % every === 0) landed++
    },
    pending: () => {
      assert.ok(open.length < DAG_READBACK_SLOTS, 'a feedback asked with every slot taken')
      asked++
      return new Promise<boolean>((done) => open.push({ due: tick + late, done: () => done(true) }))
    },
    progress: () => landed,
    arriving: () => false,
    error: (error) => assert.fail(String(error)),
    limited: () => void limited++,
    ...(skip && { skip: () => skip(tick) }),
  })
  run.invalidate()
  for (tick = 1; tick <= ticks; tick++) {
    drawnThisTick = 0
    const had = frames.size > 0,
      before = asked
    frames.run()
    assert.ok(drawnThisTick <= 1, 'drawn twice in one tick')
    drawn.push(drawnThisTick)
    askedAt.push(asked - before)
    if (!had) idleTicks.push(tick)
    while (open.length && open[0].due <= tick) open.shift()!.done()
    await decided()
  }
  return { drawn, drawnAt, askedAt, idleTicks, asked, limited, frames, landed }
}
