/** Whether `held` names exactly what `next` names, entry by entry, by identity: the one compare of
 *  a cached GPU object's key — a bind group's resources, a bundle's stream, a mip chain's place. */
export function sameEntries(held: readonly unknown[], next: readonly unknown[]) {
  if (held.length !== next.length) return false
  for (let i = 0; i < next.length; i++) if (held[i] !== next[i]) return false
  return true
}

/** `held` made to name what `next` names; true when it named something else before. */
export function adoptEntries(held: unknown[], next: readonly unknown[]) {
  const moved = !sameEntries(held, next)
  if (moved) {
    held.length = next.length
    for (let i = 0; i < next.length; i++) held[i] = next[i]
  }
  return moved
}
