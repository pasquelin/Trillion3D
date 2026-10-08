/** The typed arrays a list or a table is held in. */
type Typed =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array

/**
 * The one growth rule of a list or a table held in a typed array: `old` itself when it holds
 * `length` entries already; else a new array of the same kind, at least `length` entries and at
 * least twice `old`'s — a list grown one entry at a time is copied a logarithmic number of times
 * —, holding `old`'s entries, the rest `fill`. A count kept beside it is the caller's: the array is
 * the capacity.
 */
export function resized<T extends Typed>(old: T, length: number, fill = 0): T {
  if (old.length >= length) return old
  const next = new (old.constructor as new (length: number) => T)(Math.max(length, old.length * 2))
  next.set(old)
  if (fill !== 0) next.fill(fill, old.length)
  return next
}
