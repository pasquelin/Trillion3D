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
