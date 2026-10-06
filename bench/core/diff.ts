// Recursive bitwise comparison of arbitrary data structures.
// `Object.is` separates -0 from +0 and identifies NaN. Checks TypedArray, Array, Set, Map, Object.

/** Typed array kinds this comparison understands; a bench never compares any other kind. */
type TypedArray =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array

const TYPES: readonly (new (length: number) => ArrayBufferView)[] = [
  Float64Array,
  Float32Array,
  Int32Array,
  Uint32Array,
  Int16Array,
  Uint16Array,
  Int8Array,
  Uint8Array,
]

/** Without `some`: this test is on the hot path, a closure per visited node would cost more. */
function estTypedArray(v: unknown): v is TypedArray {
  for (let i = 0; i < TYPES.length; i++) if (v instanceof TYPES[i]) return true
  return false
}

/**
 * Keys of two objects, in the same order, or `null` if they differ. Strings are
 * joined only on the divergence branch: in nominal execution this test constructs nothing.
 */
function sameKeys(a: object, b: object): string[] | null {
  const keysA = Object.keys(a).sort(),
    keysB = Object.keys(b).sort()
  if (keysA.length !== keysB.length) return null
  for (let i = 0; i < keysA.length; i++) if (keysA[i] !== keysB[i]) return null
  return keysA
}

const keyDifference = (a: object, b: object) =>
  `champs ${Object.keys(a).sort().join(',')} ≠ ${Object.keys(b).sort().join(',')}`

/**
 * Both sides are expected to share shape, by the bench's own contract (an oracle result compared
 * to the candidate's): a boundary TypeScript cannot prove from a plain OR of two type guards.
 */
function commeTypedArrays(a: unknown, b: unknown): [TypedArray, TypedArray] | null {
  if (!estTypedArray(a) && !estTypedArray(b)) return null
  return [a as TypedArray, b as TypedArray]
}

/** First bitwise discrepancy between two values, or `null` if strictly identical. */
export function gap(a: unknown, b: unknown, path = '', depth = 0): string | null {
  if (depth > 8) throw new Error('GAP_MAX_DEPTH')
  if (Object.is(a, b)) return null
  if (typeof a === 'number' || typeof b === 'number') return `${path}: ${String(a)} ≠ ${String(b)}`
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
    return `${path}: ${String(a)} ≠ ${String(b)}`
  const ta = commeTypedArrays(a, b)
  if (ta) {
    const [ao, bo] = ta
    if (ao.constructor !== bo.constructor)
      return `${path}: ${ao.constructor?.name} ≠ ${bo.constructor?.name}`
    if (ao.length !== bo.length) return `${path}: length ${ao.length} ≠ ${bo.length}`
    for (let i = 0; i < ao.length; i++)
      if (!Object.is(ao[i], bo[i])) return `${path}[${i}]: ${ao[i]} ≠ ${bo[i]}`
    return null
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: array expected on both sides`
    if (a.length !== b.length) return `${path}: length ${a.length} ≠ ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const e = gap(a[i], b[i], `${path}[${i}]`, depth + 1)
      if (e) return e
    }
    return null
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return `${path}: Set expected on both sides`
    return gap([...a], [...b], `${path}(Set)`, depth + 1)
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return `${path}: Map expected on both sides`
    return gap([...a], [...b], `${path}(Map)`, depth + 1)
  }
  const keys = sameKeys(a, b)
  if (!keys) return `${path}: ${keyDifference(a, b)}`
  const ao = a as Record<string, unknown>,
    bo = b as Record<string, unknown>
  for (const key of keys) {
    const e = gap(ao[key], bo[key], `${path}.${key}`, depth + 1)
    if (e) return e
  }
  return null
}
