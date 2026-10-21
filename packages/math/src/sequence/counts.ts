/** Counts `key` by `by` in `counts` and returns its new count: a key whose count reaches zero
 *  leaves the map, one below zero too. An absent key counts from 0. */
export function countBy<K>(counts: Map<K, number>, key: K, by: number) {
  const n = (counts.get(key) ?? 0) + by
  if (n > 0) counts.set(key, n)
  else counts.delete(key)
  return n
}

/** Appends `value` to the list `lists` holds at `key`, a list made at its first value; the list. */
export function appendTo<K, V>(lists: Map<K, V[]>, key: K, value: V) {
  let list = lists.get(key)
  if (list) list.push(value)
  else lists.set(key, (list = [value]))
  return list
}
