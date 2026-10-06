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
 * `shape`'s object, read once — `tries` requests — for every caller until it lands; landed, the
 * next caller asks it again. Failed, it is reported once to `failed` and asked again, but a 4xx:
 * refused while the shape is held.
 */
export function readShared(
  shape: SharedShape,
  failed: (error: EngineError) => void,
  tries?: number,
) {
  if (shape.refused) return Promise.reject(shape.refused)
  if (shape.read) return shape.read
  const abort = new AbortController()
  // Whatever the read throws, its failure is an object: reported once, known again (`hasReported`).
  const read = cookedBytes(shape.url, abort.signal, tries).catch((error: unknown) => {
    throw error instanceof Object ? error : new Error(String(error))
  })
  const settled = (error?: unknown) => {
    if (abort.signal.aborted || shape.read !== read) return
    shape.read = shape.abort = null
    if (error === undefined) return
    reported.add(error as object)
    failed(error as EngineError)
    // A refusal another request would meet again: only an HTTP one, an `EngineError`.
    if (!retriableError(error)) shape.refused = error as Error
  }
  read.then(() => settled(), settled)
  shape.read = read
  shape.abort = abort
  return read
}
