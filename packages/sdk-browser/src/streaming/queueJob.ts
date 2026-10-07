import type { Job, StreamPage } from './types.ts'

/** A queued read of `page`, the promise its askers share (`waitShared`). */
export function createJob(page: StreamPage, priority: number, order: number): Job {
  let resolve!: (value: Uint8Array) => void, reject!: (reason: unknown) => void
  const promise = new Promise<Uint8Array>((yes, no) => {
    resolve = yes
    reject = no
  })
  // A job its askers all let go is dropped: the rejection no one waits for is not unhandled.
  promise.catch(() => {})
  const { url, bytes, range } = page
  return {
    url,
    priority,
    order,
    bytes,
    slot: -1,
    range,
    state: 'queued',
    askers: 0,
    ...{ promise, resolve, reject },
  }
}
