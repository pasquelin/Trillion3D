// Mesurer un écart, pas seulement le constater. Le lot C déplace parfois l'ordre des opérations
// flottantes : ce fichier compte les valeurs qui diffèrent et dit de combien, en ULP, pour que le
// tableau porte un chiffre là où le lot A ne portait qu'un « non ».

const vue = new DataView(new ArrayBuffer(8));

/** Rang monotone d'un flottant dans l'ordre des bits : la différence de deux rangs est l'écart ULP. */
function rang(x, bits) {
  if (bits === 32) {
    vue.setFloat32(0, x);
    const b = vue.getInt32(0);
    return BigInt(b < 0 ? -2147483648 - b : b);
  }
  vue.setFloat64(0, x);
  const b = vue.getBigInt64(0);
  return b < 0n ? -9223372036854775808n - b : b;
}

/** Écart en ULP entre deux flottants. `Infinity` dès qu'un NaN ou un infini n'est pas partagé. */
export function ulpEntre(a, b, bits = 64) {
  if (Object.is(a, b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  const d = rang(a, bits) - rang(b, bits);
  return Number(d < 0n ? -d : d);
}

/** Compteur d'écarts : combien de valeurs diffèrent, de combien d'ULP au plus, et la première vue. */
export function compteur() {
  return { nombre: 0, ulpMax: 0, premier: null, pixelsId: 0, pixelsProfondeur: 0, horsCoupe: 0 };
}

export function note(c, a, b, chemin, bits = 64) {
  if (Object.is(a, b)) return;
  c.nombre++;
  const u = ulpEntre(a, b, bits);
  if (u > c.ulpMax) c.ulpMax = u;
  c.premier ??= `${chemin}: ${String(a)} ≠ ${String(b)} (${u} ULP)`;
}

function rate(c, chemin, texte) {
  c.nombre++;
  c.ulpMax = Infinity;
  c.premier ??= `${chemin}: ${texte}`;
  return c;
}

const TYPES = [Float64Array, Float32Array, Int32Array, Uint32Array, Uint16Array, Uint8Array];
const typee = (v) => TYPES.some((T) => v instanceof T);
const liste = (v) => (v instanceof Set || v instanceof Map ? [...v] : v);

/** Parcours générique : tableaux typés valeur par valeur, le reste champ par champ. */
export function parcours(c, a, b, chemin = '', profondeur = 0) {
  if (Object.is(a, b)) return c;
  if (profondeur > 8) throw new Error('BANC_PROFONDEUR');
  if (typeof a === 'number' || typeof b === 'number') {
    note(c, a, b, chemin);
    return c;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
    return rate(c, chemin, `${String(a)} ≠ ${String(b)}`);
  if (typee(a) || typee(b)) {
    if (a.constructor !== b.constructor || a.length !== b.length)
      return rate(
        c,
        chemin,
        `${a.constructor?.name}[${a.length}] ≠ ${b.constructor?.name}[${b.length}]`,
      );
    const bits = a instanceof Float32Array ? 32 : 64;
    for (let i = 0; i < a.length; i++) note(c, a[i], b[i], `${chemin}[${i}]`, bits);
    return c;
  }
  const ga = liste(a),
    gb = liste(b);
  if (Array.isArray(ga) || Array.isArray(gb)) {
    if (!Array.isArray(ga) || !Array.isArray(gb) || ga.length !== gb.length)
      return rate(c, chemin, `longueur ${ga?.length} ≠ ${gb?.length}`);
    for (let i = 0; i < ga.length; i++)
      parcours(c, ga[i], gb[i], `${chemin}[${i}]`, profondeur + 1);
    return c;
  }
  const cles = Object.keys(a).sort(),
    autres = Object.keys(b).sort();
  if (cles.join(',') !== autres.join(','))
    return rate(c, chemin, `champs ${cles.join(',')} ≠ ${autres.join(',')}`);
  for (const cle of cles) parcours(c, a[cle], b[cle], `${chemin}.${cle}`, profondeur + 1);
  return c;
}
