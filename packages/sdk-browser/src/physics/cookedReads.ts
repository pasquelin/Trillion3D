import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { SharedShape } from './sharedShapes.ts'
import { cookedBytes } from './tilePlace.ts'
import { retriableError } from '../cluster/checked.ts'

/** What a read of a refused object rejects with: its refusal, reported already. */
const REFUSED = new Error('A refused cooked object is not read again while it is held.')

/**
 * `shape`'s object, read once — `tries` requests — for every caller; landed, kept while the
 * shape is held until restored (`SharedShapes.restore`). A failed read is reported once, to
 * `failed`, its callers only dropping it; asked again, but a 4xx: refused while it is held.
 */
export function readShared(
  shape: SharedShape,
  failed: (error: EngineError) => void,
  tries?: number,
) {
  if (shape.refused) return Promise.reject(REFUSED)
  if (shape.read) return shape.read
  const abort = new AbortController()
  const read = cookedBytes(shape.url, abort.signal, tries)
  const settled = (error?: unknown) => {
    if (abort.signal.aborted || shape.read !== read) return
    shape.abort = null
    if (error === undefined) return
    shape.read = null
    failed(error as EngineError)
    // A refusal another request would meet again: an HTTP 4xx.
    shape.refused = !retriableError(error)
  }
  read.then(() => settled(), settled)
  shape.read = read
  shape.abort = abort
  return read
}
