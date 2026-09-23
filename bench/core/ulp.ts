// Measure a discrepancy, not just observe it. Certain optimizations reorder
// floating point operations: this file counts differing values and states by how much, in ULP,
// so that the table displays a number where strict equality would only show a "no".
// Type list and key comparison come from `ecart.ts`: single rule for two
// traversals, otherwise one knows a type that the other ignores.
import { differenceDeCles, estTypedArray, memesCles } from './ecart.ts';
import type { TypedArray } from './ecart.ts';

/** How many values differ, by at most how many ULP, and the first discrepancy seen. */
export interface Compteur {
  nombre: number;
  ulpMax: number;
  premier: string | null;
}

const vue = new DataView(new ArrayBuffer(8));

/**
 * Monotonic rank of a float in bit order: difference of two ranks is ULP discrepancy.
 * 32-bit rank fits in a double int, so no `BigInt` on this path — it is used by
 * images and `Float32Array`, called hundreds of thousands of times during comparison.
 */
function rang32(x: number) {
  vue.setFloat32(0, x);
  const b = vue.getInt32(0);
  return b < 0 ? -2147483648 - b : b;
}

function rang64(x: number) {
  vue.setFloat64(0, x);
  const b = vue.getBigInt64(0);
  return b < 0n ? -9223372036854775808n - b : b;
}

/** ULP discrepancy between two floats. `Infinity` as soon as NaN or infinity is not shared. */
function ulpEntre(a: number, b: number, bits = 64) {
  if (Object.is(a, b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  if (bits === 32) return Math.abs(rang32(a) - rang32(b));
  const d = rang64(a) - rang64(b);
  return Number(d < 0n ? -d : d);
}

/** Discrepancy counter: how many values differ, by at most how many ULP, and first seen. */
export function compteur(): Compteur {
  return { nombre: 0, ulpMax: 0, premier: null };
}

export function note(c: Compteur, a: number, b: number, chemin: string, bits = 64) {
  if (Object.is(a, b)) return;
  c.nombre++;
  const u = ulpEntre(a, b, bits);
  if (u > c.ulpMax) c.ulpMax = u;
  c.premier ??= `${chemin}: ${String(a)} ≠ ${String(b)} (${u} ULP)`;
}

function rate(c: Compteur, chemin: string, texte: string) {
  c.nombre++;
  c.ulpMax = Infinity;
  c.premier ??= `${chemin}: ${texte}`;
  return c;
}

const liste = (v: unknown) => (v instanceof Set || v instanceof Map ? [...v] : v);

/** Generic traversal: typed arrays value by value, remainder field by field. */
export function parcours(
  c: Compteur,
  a: unknown,
  b: unknown,
  chemin = '',
  profondeur = 0,
): Compteur {
  if (Object.is(a, b)) return c;
  if (profondeur > 8) throw new Error('ECART_PROFONDEUR_MAX');
  if (typeof a === 'number' || typeof b === 'number') {
    note(c, a as number, b as number, chemin);
    return c;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
    return rate(c, chemin, `${String(a)} ≠ ${String(b)}`);
  if (estTypedArray(a) || estTypedArray(b)) {
    const ao = a as TypedArray,
      bo = b as TypedArray;
    if (ao.constructor !== bo.constructor || ao.length !== bo.length)
      return rate(
        c,
        chemin,
        `${ao.constructor?.name}[${ao.length}] ≠ ${bo.constructor?.name}[${bo.length}]`,
      );
    const bits = ao instanceof Float32Array ? 32 : 64;
    for (let i = 0; i < ao.length; i++) note(c, ao[i], bo[i], `${chemin}[${i}]`, bits);
    return c;
  }
  const ga = liste(a),
    gb = liste(b);
  if (Array.isArray(ga) || Array.isArray(gb)) {
    if (!Array.isArray(ga) || !Array.isArray(gb) || ga.length !== gb.length)
      return rate(
        c,
        chemin,
        `longueur ${(ga as unknown[] | undefined)?.length} ≠ ${(gb as unknown[] | undefined)?.length}`,
      );
    for (let i = 0; i < ga.length; i++)
      parcours(c, ga[i], gb[i], `${chemin}[${i}]`, profondeur + 1);
    return c;
  }
  const cles = memesCles(a, b);
  if (!cles) return rate(c, chemin, differenceDeCles(a, b));
  const ao = a as Record<string, unknown>,
    bo = b as Record<string, unknown>;
  for (const cle of cles) parcours(c, ao[cle], bo[cle], `${chemin}.${cle}`, profondeur + 1);
  return c;
}
