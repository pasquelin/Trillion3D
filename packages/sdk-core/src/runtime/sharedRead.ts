/** A read its askers share: what it brings, how many wait on it, and what stops it. Each asker
 *  waits until its own signal lets it go (`waitShared`); the last to go stops it, and a read
 *  stopped is never joined again: whoever asks next starts another. */
export type SharedRead<T> = { promise: Promise<T>; askers: number; stop: AbortController }

/** `read` waited on by one more asker until `signal` lets it go: the last to go stops it. */
export function waitShared<T>(read: SharedRead<T>, signal?: AbortSignal) {
  read.askers++
  if (!signal) return read.promise
  return new Promise<T>((resolve, reject) => {
    const leave = () => {
      if (--read.askers === 0) read.stop.abort(signal.reason)
      reject(signal.reason)
    }
    if (signal.aborted) return leave()
    signal.addEventListener('abort', leave, { once: true })
    const done = () => signal.removeEventListener('abort', leave)
    read.promise.then(
      (value) => (done(), resolve(value)),
      (error: unknown) => (done(), reject(error)),
    )
  })
}
