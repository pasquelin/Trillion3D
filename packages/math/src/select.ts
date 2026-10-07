/**
 * Rearranges `items[start, end)` in place so that `items[at]` is the one of rank `at` by `key`,
 * those of smaller keys before it and of larger after, in no order: a selection by repeated
 * partition, O(n) on average where a sort is O(n log n).
 */
export function selectByKey<T>(
  items: { [index: number]: T },
  key: (item: T) => number,
  start: number,
  end: number,
  at: number,
) {
  let low = start,
    high = end - 1
  while (low < high) {
    const pivot = key(items[(low + high) >> 1])
    let i = low,
      j = high
    while (i <= j) {
      while (key(items[i]) < pivot) i++
      while (key(items[j]) > pivot) j--
      if (i > j) break
      const item = items[i]
      items[i++] = items[j]
      items[j--] = item
    }
    if (at <= j) high = j
    else if (at >= i) low = i
    else return
  }
}

/** Moves the items of `items[0, end)` that `keep` holds to its front, in place, the others after:
 *  where the kept end. */
export function partitionBy<T>(items: T[], end: number, keep: (item: T) => boolean) {
  let at = 0
  for (let i = 0; i < end; i++)
    if (keep(items[i])) {
      const item = items[at]
      items[at++] = items[i]
      items[i] = item
    }
  return at
}
