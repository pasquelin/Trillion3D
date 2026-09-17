// Comparaison bit à bit récursive de deux structures de données arbitraires.
// `Object.is` sépare -0 de +0 et identifie NaN. Vérifie TypedArray, Array, Set, Map, Object.
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

const estTypedArray = (v) => TYPES.some((T) => v instanceof T);

/** Premier écart bit à bit entre deux valeurs, ou `null` si strictement identiques. */
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
    if (a.length !== b.length) return `${chemin}: longueur ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++)
      if (!Object.is(a[i], b[i])) return `${chemin}[${i}]: ${a[i]} ≠ ${b[i]}`;
    return null;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${chemin}: tableau attendu des deux côtés`;
    if (a.length !== b.length) return `${chemin}: longueur ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const e = ecart(a[i], b[i], `${chemin}[${i}]`, profondeur + 1);
      if (e) return e;
    }
    return null;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return `${chemin}: Set attendu des deux côtés`;
    return ecart([...a], [...b], `${chemin}(Set)`, profondeur + 1);
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return `${chemin}: Map attendu des deux côtés`;
    return ecart([...a], [...b], `${chemin}(Map)`, profondeur + 1);
  }
  const clesA = Object.keys(a).sort();
  const clesB = Object.keys(b).sort();
  if (clesA.join(',') !== clesB.join(','))
    return `${chemin}: champs ${clesA.join(',')} ≠ ${clesB.join(',')}`;
  for (const cle of clesA) {
    const e = ecart(a[cle], b[cle], `${chemin}.${cle}`, profondeur + 1);
    if (e) return e;
  }
  return null;
}
