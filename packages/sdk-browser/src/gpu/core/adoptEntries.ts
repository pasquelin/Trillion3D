import { copyInto, sameValues } from '../../../../math/src/matrix/matrixElements.ts'

/** `held` made to name what `next` names, entry by entry, by identity (`sameValues`): a cached GPU
 *  object's key. True when it named something else before. */
export function adoptEntries<T>(held: T[], next: ArrayLike<T>) {
  const moved = !sameValues(held, next)
  if (moved) copyInto(held, next)
  return moved
}
