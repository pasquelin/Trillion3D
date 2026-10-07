/** The waiters each signal lets go: one listener a signal, whatever the waiters on it — a signal a
 *  hundred thousand reads wait on pays one listener, never a scan of its listeners per waiter. */
const leaving = new WeakMap<AbortSignal, Set<() => void>>()

/** `leave` runs once `signal` aborts, unless the returned stop runs first. */
function heard(signal: AbortSignal, leave: () => void) {
  let own = leaving.get(signal)
  if (!own) {
    const waiters = (own = new Set())
    leaving.set(signal, own)
    signal.addEventListener('abort', () => waiters.forEach((each) => each()), { once: true })
  }
  own.add(leave)
  return () => void own.delete(leave)
}

/** `promise` waited on until `signal` lets the waiter go: it rejects with the signal's reason
 *  then, `leave` told first. */
export function waited<T>(promise: Promise<T>, signal?: AbortSignal, leave?: () => void) {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const abort = () => (leave?.(), reject(signal.reason))
    if (signal.aborted) return abort()
    const done = heard(signal, abort)
    promise.then(
      (value) => (done(), resolve(value)),
      (error: unknown) => (done(), reject(error)),
    )
  })
}

/** A read its askers share: what it brings, and how many wait on it. Each asker waits until its
 *  own signal lets it go (`waitShared`); the last to go runs what its owner says. */
export type SharedRead<T> = { promise: Promise<T>; askers: number }

/** `read` waited on by one more asker until `signal` lets it go: the last to go runs `last` — a
 *  download stopped, a queued read dropped. */
export function waitShared<T>(
  read: SharedRead<T>,
  signal: AbortSignal | undefined,
  last: () => void,
) {
  read.askers++
  return waited(read.promise, signal, () => {
    if (--read.askers === 0) last()
  })
}
