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

/** Sans `some` : ce test est sur le chemin chaud, une fermeture par nœud visité coûterait plus. */
export function estTypedArray(v) {
  for (let i = 0; i < TYPES.length; i++) if (v instanceof TYPES[i]) return true;
  return false;
}

/**
 * Les clés de deux objets, dans le même ordre, ou `null` si elles diffèrent. Les chaînes ne sont
 * jointes que dans la branche de divergence : en régime nominal ce test ne construit rien.
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
  const cles = memesCles(a, b);
  if (!cles) return `${chemin}: ${differenceDeCles(a, b)}`;
  for (const cle of cles) {
    const e = ecart(a[cle], b[cle], `${chemin}.${cle}`, profondeur + 1);
    if (e) return e;
  }
  return null;
}
