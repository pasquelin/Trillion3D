import { cpuNow } from '../diagnostic/stopwatch.ts'

/** The next display frame's timestamp (`requestAnimationFrame`), ms: the one frame wait of the
 *  engine. `signal` aborting first rejects with its reason and cancels the request. */
export function nextFrame(signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => {
      cancelAnimationFrame(id)
      reject(signal!.reason)
    }
    const id = requestAnimationFrame((time) => {
      signal?.removeEventListener('abort', abort)
      resolve(time)
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** When the current display frame began, ms: the timestamp `requestAnimationFrame` hands its
 *  callbacks, which the document timeline holds for the whole frame, so work done before the read
 *  does not shift it; the CPU clock where there is no document. */
export function frameStart(): number {
  const time = globalThis.document?.timeline?.currentTime
  return typeof time === 'number' ? time : cpuNow()
}

/** A timer that never holds a Node process open on its own; a browser has no such notion. */
export function later(report: () => void, delayMs: number) {
  const timer = setTimeout(report, delayMs)
  const node: { unref?: () => void } = Object(timer)
  node.unref?.()
  return timer
}
