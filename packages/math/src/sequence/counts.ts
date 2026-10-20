/** Counts `key` by `by` in `counts` and returns its new count: a key whose count reaches zero
 *  leaves the map, one below zero too. An absent key counts from 0. */
export function countBy<K>(counts: Map<K, number>, key: K, by: number) {
  const n = (counts.get(key) ?? 0) + by
  if (n > 0) counts.set(key, n)
  else counts.delete(key)
  return n
}
