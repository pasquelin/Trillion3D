/** `promise` waited on until `signal` lets the waiter go: it rejects with the signal's reason
 *  then, `leave` told first. */
export function waited<T>(promise: Promise<T>, signal?: AbortSignal, leave?: () => void) {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const abort = () => (leave?.(), reject(signal.reason))
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    const done = () => signal.removeEventListener('abort', abort)
    promise.then(
      (value) => (done(), resolve(value)),
      (error: unknown) => (done(), reject(error)),
    )
  })
}

/** A read its askers share: what it brings, how many wait on it, and what stops it. Each asker
 *  waits until its own signal lets it go (`waitShared`); the last to go stops it, and a read
 *  stopped is never joined again: whoever asks next starts another. */
export type SharedRead<T> = { promise: Promise<T>; askers: number; stop: AbortController }

/** `read` waited on by one more asker until `signal` lets it go: the last to go stops it. */
export function waitShared<T>(read: SharedRead<T>, signal?: AbortSignal) {
  read.askers++
  return waited(read.promise, signal, () => {
    if (--read.askers === 0) read.stop.abort(signal!.reason)
  })
}
