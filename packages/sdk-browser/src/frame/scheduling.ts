function active(signal: AbortSignal): void {
  signal.throwIfAborted()
}
export function nextFrame(signal: AbortSignal): Promise<number> {
  active(signal)
  return new Promise((resolve, reject) => {
    const abort = () => {
      cancelAnimationFrame(id)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    const id = requestAnimationFrame((time) => {
      signal.removeEventListener('abort', abort)
      resolve(time)
    })
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** When the current display frame began, ms: the timestamp `requestAnimationFrame` hands its
 *  callbacks, which the document timeline holds for the whole frame, so work done before the read
 *  does not shift it; `performance.now()` where there is no document. */
export function frameStart(): number {
  const time = globalThis.document?.timeline?.currentTime
  return typeof time === 'number' ? time : performance.now()
}
