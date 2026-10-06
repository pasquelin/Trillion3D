import { mock } from 'node:test'
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
