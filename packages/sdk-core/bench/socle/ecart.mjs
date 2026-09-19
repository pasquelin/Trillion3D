// Recursive bitwise comparison of arbitrary data structures.
// `Object.is` separates -0 from +0 and identifies NaN. Checks TypedArray, Array, Set, Map, Object.
const TYPES = [
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
export function estTypedArray(v) {
  for (let i = 0; i < TYPES.length; i++) if (v instanceof TYPES[i]) return true;
  return false;
}

/**
 * Keys of two objects, in the same order, or `null` if they differ. Strings are
 * joined only on the divergence branch: in nominal execution this test constructs nothing.
 */
export function memesCles(a, b) {
  const clesA = Object.keys(a).sort(),
    clesB = Object.keys(b).sort();
  if (clesA.length !== clesB.length) return null;
  for (let i = 0; i < clesA.length; i++) if (clesA[i] !== clesB[i]) return null;
  return clesA;
}

export const differenceDeCles = (a, b) =>
  `champs ${Object.keys(a).sort().join(',')} ≠ ${Object.keys(b).sort().join(',')}`;

/** First bitwise discrepancy between two values, or `null` if strictly identical. */
export function ecart(a, b, chemin = '', profondeur = 0) {
  if (profondeur > 8) throw new Error('ECART_PROFONDEUR_MAX');
  if (Object.is(a, b)) return null;
  if (typeof a === 'number' || typeof b === 'number')
    return `${chemin}: ${String(a)} ≠ ${String(b)}`;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
    return `${chemin}: ${String(a)} ≠ ${String(b)}`;
  if (estTypedArray(a) || estTypedArray(b)) {
    if (a.constructor !== b.constructor)
      return `${chemin}: ${a.constructor?.name} ≠ ${b.constructor?.name}`;
    if (a.length !== b.length) return `${chemin}: length ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++)
      if (!Object.is(a[i], b[i])) return `${chemin}[${i}]: ${a[i]} ≠ ${b[i]}`;
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
  for (const cle of cles) {
    const e = ecart(a[cle], b[cle], `${chemin}.${cle}`, profondeur + 1);
    if (e) return e;
  }
  return null;
}
