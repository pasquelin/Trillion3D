/** Makes or drops the holds of a kind so that it has one for each pass of its kind in the chain. */
export function resizeHolds<Held>(
  held: Held[],
  count: number,
  make: () => Held,
  drop: (hold: Held) => void,
) {
  while (held.length < count) held.push(make())
  while (held.length > count) drop(held.pop()!)
}

/** Drops every hold of a kind. */
export function dropHolds<Held>(held: Held[], drop: (hold: Held) => void) {
  held.forEach(drop)
  held.length = 0
}
