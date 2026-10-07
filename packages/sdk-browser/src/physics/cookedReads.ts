import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import { readCookedPhysics } from '../../../sdk-core/src/physics/index.ts'
import type { SharedShape } from './sharedShapes.ts'
import { cookedHref, type Model } from './tilePlace.ts'
import { checked, optionalFile, retriableError } from '../cluster/checked.ts'

/** The bytes of a cooked object — a tile, a hull, a soft body's settings — read as every cache
 *  file is (`checked`, in `tries` requests), until `signal` aborts. */
async function cookedBytes(href: string, signal: AbortSignal, tries?: number) {
  const response = await checked(href, signal, tries)
  return new Uint8Array(await response.arrayBuffer())
}

/** The cooked physics beside `model`'s manifest (`physics.json`), until `signal` aborts; `null`
 *  for a model compiled before the cook, which has none. */
export async function cookedPhysics(model: Model, signal: AbortSignal) {
  const response = await optionalFile(cookedHref(model, 'physics.json'), signal)
  return response && readCookedPhysics(await response.json())
}

/** What a read of a refused object rejects with: its refusal, reported already. */
const REFUSED = new Error('A refused cooked object is not read again while it is held.')

/**
 * `shape`'s object, read once — `tries` requests — for every caller until it lands; a soft body's
 * settings kept as they land, while held. A failed read is reported once, to `failed`, its callers
 * only dropping it; asked again, but a 4xx: refused while the shape is held.
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
  /** Whether `read` is still `shape`'s: none let go of it, its last holder leaving. */
  const settled = () => {
    const current = !abort.signal.aborted && shape.read === read
    if (current) shape.read = shape.abort = null
    return current
  }
  read.then(
    (bytes) => {
      if (settled() && shape.kind === 'settings') shape.landed = bytes
    },
    (error) => {
      if (!settled()) return
      failed(error as EngineError)
      // A refusal another request would meet again: an HTTP 4xx.
      shape.refused = !retriableError(error)
    },
  )
  shape.read = read
  shape.abort = abort
  return read
}
