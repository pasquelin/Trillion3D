import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { SharedShape } from './sharedShapes.ts'
import { cookedBytes } from './tilePlace.ts'
import { retriableError } from '../cluster/checked.ts'

/** The failed reads reported already: a body one refuses is not reported again. */
const reported = new WeakSet<object>()

/** Whether `error` is a failed read reported already (`readShared`). */
export const hasReported = (error: unknown) =>
  typeof error === 'object' && error !== null && reported.has(error)

/**
 * `shape`'s object, read once — `tries` requests — for every caller until it lands. Landed, the
 * next caller asks it again, but a soft body's settings, kept for the session; failed, it is
 * reported once to `failed` and asked again, but a 4xx: refused for the session, never asked
 * again.
 */
export function readShared(
  shape: SharedShape,
  failed: (error: EngineError) => void,
  tries?: number,
) {
  if (shape.refused) return Promise.reject(shape.refused)
  if (shape.read) return shape.read
  const abort = new AbortController()
  const read = cookedBytes(shape.url, abort.signal, tries)
  const settled = (error?: unknown) => {
    if (abort.signal.aborted || shape.read !== read) return
    shape.abort = null
    if (error === undefined && shape.kind === 'settings') return
    shape.read = null
    if (error === undefined) return
    reported.add(error as object)
    failed(error as EngineError)
    if (!retriableError(error)) shape.refused = error as Error
  }
  read.then(() => settled(), settled)
  shape.read = read
  shape.abort = abort
  return read
}
