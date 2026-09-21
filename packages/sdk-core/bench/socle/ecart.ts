// Recursive bitwise comparison of arbitrary data structures.
// `Object.is` separates -0 from +0 and identifies NaN. Checks TypedArray, Array, Set, Map, Object.

/** Typed array kinds this comparison understands; a bench never compares any other kind. */
export type TypedArray =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array;

const TYPES: readonly Function[] = [
  Float64Array,
  Float32Array,
  Int32Array,
  Uint32Array,
  Int16Array,
  Uint16Array,
  Int8Array,
  Uint8Array,
];

/** Without `some`: this test is on the hot path, a closure per visited node would cost more. */
export function estTypedArray(v: unknown): v is TypedArray {
  for (let i = 0; i < TYPES.length; i++) if (v instanceof TYPES[i]) return true;
  return false;
}

/**
 * Keys of two objects, in the same order, or `null` if they differ. Strings are
 * joined only on the divergence branch: in nominal execution this test constructs nothing.
 */
export function memesCles(a: object, b: object): string[] | null {
  const clesA = Object.keys(a).sort(),
    clesB = Object.keys(b).sort();
  if (clesA.length !== clesB.length) return null;
  for (let i = 0; i < clesA.length; i++) if (clesA[i] !== clesB[i]) return null;
  return clesA;
}

export const differenceDeCles = (a: object, b: object) =>
  `champs ${Object.keys(a).sort().join(',')} ≠ ${Object.keys(b).sort().join(',')}`;

/**
 * Both sides are expected to share shape, by the bench's own contract (an oracle result compared
 * to the candidate's): a boundary TypeScript cannot prove from a plain OR of two type guards.
 */
function commeTypedArrays(a: unknown, b: unknown): [TypedArray, TypedArray] | null {
  if (!estTypedArray(a) && !estTypedArray(b)) return null;
  return [a as TypedArray, b as TypedArray];
}

/** First bitwise discrepancy between two values, or `null` if strictly identical. */
export function ecart(a: unknown, b: unknown, chemin = '', profondeur = 0): string | null {
  if (profondeur > 8) throw new Error('ECART_PROFONDEUR_MAX');
  if (Object.is(a, b)) return null;
  if (typeof a === 'number' || typeof b === 'number')
    return `${chemin}: ${String(a)} ≠ ${String(b)}`;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
    return `${chemin}: ${String(a)} ≠ ${String(b)}`;
  const ta = commeTypedArrays(a, b);
  if (ta) {
    const [ao, bo] = ta;
    if (ao.constructor !== bo.constructor)
      return `${chemin}: ${ao.constructor?.name} ≠ ${bo.constructor?.name}`;
    if (ao.length !== bo.length) return `${chemin}: length ${ao.length} ≠ ${bo.length}`;
    for (let i = 0; i < ao.length; i++)
      if (!Object.is(ao[i], bo[i])) return `${chemin}[${i}]: ${ao[i]} ≠ ${bo[i]}`;
    return null;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${chemin}: array expected on both sides`;
    if (a.length !== b.length) return `${chemin}: length ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const e = ecart(a[i], b[i], `${chemin}[${i}]`, profondeur + 1);
      if (e) return e;
    }
    return null;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return `${chemin}: Set expected on both sides`;
    return ecart([...a], [...b], `${chemin}(Set)`, profondeur + 1);
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return `${chemin}: Map expected on both sides`;
    return ecart([...a], [...b], `${chemin}(Map)`, profondeur + 1);
  }
  const cles = memesCles(a, b);
  if (!cles) return `${chemin}: ${differenceDeCles(a, b)}`;
  const ao = a as Record<string, unknown>,
    bo = b as Record<string, unknown>;
  for (const cle of cles) {
    const e = ecart(ao[cle], bo[cle], `${chemin}.${cle}`, profondeur + 1);
    if (e) return e;
  }
  return null;
}
