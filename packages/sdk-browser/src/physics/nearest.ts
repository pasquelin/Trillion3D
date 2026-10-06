/** Something ordered by how near it is wanted. */
type Near = { near: number }

/** Moves the items of `list[from, to)` that `keep` holds to its front, in place: where they end. */
export function partition<T>(list: T[], from: number, to: number, keep: (item: T) => boolean) {
  let at = from
  for (let i = from; i < to; i++)
    if (keep(list[i])) {
      const item = list[at]
      list[at++] = list[i]
      list[i] = item
    }
  return at
}

/**
 * Rearranges `list[0, count)` in place so that its first `k` are its `k` nearest (`near`), in no
 * order among themselves: a selection, O(count) on average where a sort is O(count log count).
 */
export function selectNearest(list: Near[], count: number, k: number) {
  const at = k - 1
  let low = 0,
    high = count - 1
  while (at >= 0 && low < high) {
    const pivot = list[(low + high) >> 1].near
    let i = low,
      j = high
    while (i <= j) {
      while (list[i].near < pivot) i++
      while (list[j].near > pivot) j--
      if (i > j) break
      const item = list[i]
      list[i++] = list[j]
      list[j--] = item
    }
    if (at <= j) high = j
    else if (at >= i) low = i
    else return
  }
}
