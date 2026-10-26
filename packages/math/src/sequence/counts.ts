/** Counts `key` by `by` in `counts` and returns its new count: a key whose count reaches zero
 *  leaves the map, one below zero too. An absent key counts from 0. */
export function countBy<K>(counts: Map<K, number>, key: K, by: number) {
  const n = (counts.get(key) ?? 0) + by
  if (n > 0) counts.set(key, n)
  else counts.delete(key)
  return n
}

/** The value `map` holds at `key`, made by `make(key)` and held at its first ask. A `make` that
 *  captures nothing is hoisted by its caller, so a hot path makes no closure per call. */
export function entryOf<K, V>(map: Map<K, V>, key: K, make: (key: K) => V) {
  let value = map.get(key)
  if (value === undefined) map.set(key, (value = make(key)))
  return value
}

const newList = () => []

/** Appends `value` to the list `lists` holds at `key`, a list made at its first value; the list. */
export function appendTo<K, V>(lists: Map<K, V[]>, key: K, value: V) {
  const list = entryOf(lists, key, newList as () => V[])
  list.push(value)
  return list
}
