/** The words of `parts` end to end, in order: the one part itself when there is one, no copy. */
export function joinedWords(parts: Uint32Array[]) {
  if (parts.length === 1) return parts[0]
  const all = new Uint32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) all.set(part, (at += part.length) - part.length)
  return all
}
