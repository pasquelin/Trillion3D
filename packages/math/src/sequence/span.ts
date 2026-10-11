/** An inclusive range of indices, `from` to `to`: empty when `from` is past `to`. */
export interface Span {
  from: number
  to: number
}

/** `span` grown in place to hold `from` to `to` (`from` alone by default): the one rule of a range
 *  of rows written since the last upload. */
export function extendSpan(span: Span, from: number, to = from) {
  span.from = Math.min(span.from, from)
  span.to = Math.max(span.to, to)
}

/** A length or a position in a unit: ms as a number, ns as a bigint. */
type Quantity = number | bigint

/** What the span `begin` to `end` adds to the length already covered up to `reach`: the part of it
 *  past `reach`, else `zero`. */
export function addedLength<N extends Quantity>(begin: N, end: N, reach: N, zero: N): N {
  const from = begin > reach ? begin : reach
  return end > from ? (((end as bigint) - (from as bigint)) as N) : zero
}

/** The length the spans `items` cover, `begin` to `end` each, from `zero`: spans that overlap count
 *  once, a gap not at all. */
export function coveredLength<T, N extends Quantity>(
  items: readonly T[],
  begin: (item: T) => N,
  end: (item: T) => N,
  zero: N,
): N {
  let covered = zero,
    reach = zero
  for (const item of [...items].sort((a, b) =>
    begin(a) < begin(b) ? -1 : begin(a) > begin(b) ? 1 : 0,
  )) {
    covered = ((covered as bigint) +
      (addedLength(begin(item), end(item), reach, zero) as bigint)) as N
    if (end(item) > reach) reach = end(item)
  }
  return covered
}
