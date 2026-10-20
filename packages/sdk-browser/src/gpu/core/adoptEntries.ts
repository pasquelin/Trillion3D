import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'

/** `held` made to name what `next` names, entry by entry, by identity (`sameValues`): a cached GPU
 *  object's key. True when it named something else before. */
export function adoptEntries(held: unknown[], next: readonly unknown[]) {
  const moved = !sameValues(held, next)
  if (moved) {
    held.length = next.length
    for (let i = 0; i < next.length; i++) held[i] = next[i]
  }
  return moved
}
