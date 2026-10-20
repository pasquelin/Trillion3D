/** A promise and the native functions that settle it, called from elsewhere: the executor runs at
 *  once, so `resolve` and `reject` are set before this returns (the lib is ES2023, without
 *  `Promise.withResolvers`). */
export function createDeferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
