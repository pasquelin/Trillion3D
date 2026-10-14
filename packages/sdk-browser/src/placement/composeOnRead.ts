/**
 * A VIEW WHOSE `elements` A PARENT COMPOSES ON READ: the one mechanism behind a composed root's
 * world (`gpuComposeWorld.ts`) and a reader row's views (`composeReaders.ts`). The view keeps its
 * array; its `elements` becomes a getter that composes into it the first time it is read since the
 * composition's version moved — one product a read, none a move —, and is a plain value again,
 * holding the world it was last read at, once its owner lets it go (`plainAgain`).
 */
import type { MatrixElements } from '../host/matrixElements.ts'

/** Who composes each view, and the array it composes into. */
const served = new WeakMap<
  MatrixElements,
  { readonly owner: object; readonly elements: Float64Array }
>()

/**
 * `view` reads `compose(elements)` whenever `version()` moved since its last read. A view `owner`
 * composes already is left as it is; one another owner composed is taken over, its array kept.
 */
export function composeOnRead(
  view: MatrixElements,
  owner: object,
  version: () => number,
  compose: (out: Float64Array) => void,
) {
  const held = served.get(view)
  if (held?.owner === owner) return
  const elements = held?.elements ?? (view.elements as Float64Array)
  served.set(view, { owner, elements })
  let at = Number.NaN
  Object.defineProperty(view, 'elements', {
    configurable: true,
    enumerable: true,
    get: () => {
      const now = version()
      if (now !== at) {
        at = now
        compose(elements)
      }
      return elements
    },
  })
}

/** `view` is a plain value again, holding the world it was last read at — if `owner` composes it. */
export function plainAgain(view: MatrixElements, owner: object) {
  if (served.get(view)?.owner !== owner) return
  served.delete(view)
  Object.defineProperty(view, 'elements', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: view.elements,
  })
}
