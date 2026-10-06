/**
 * A READ ITS ASKERS SHARE. Each asker waits on it until its own signal lets it go (`waited`); a read
 * shared by a count of askers is stopped once the last of them lets go (`waitShared`), and one
 * stopped is never joined again: whoever asks next starts another.
 */

/** `promise` waited on until `signal` lets the waiter go: it rejects with the signal's reason then,
 *  `leave` told first. */
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

/** A read its askers share: what it brings, how many wait on it, and what stops it. */
export type SharedRead<T> = { promise: Promise<T>; askers: number; stop: AbortController }

/** `read` waited on by one more asker until `signal` lets it go: the last to go stops it. */
export function waitShared<T>(read: SharedRead<T>, signal?: AbortSignal) {
  read.askers++
  return waited(read.promise, signal, () => {
    if (--read.askers === 0) read.stop.abort(signal!.reason)
  })
}
