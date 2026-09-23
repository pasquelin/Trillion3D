// Shared tools of the foundation equivalence lines: a line of the common table, capture of a
// raise, and the TRS decomposition read on both sides in the same form.
import * as THREE from 'three';
import { decomposeMatrix4 } from '../../../../packages/sdk-core/src/index.ts';
import {
  SINGULAR_DETERMINANT,
  normalizedLinearDeterminant,
} from '../../../../packages/sdk-core/src/math/matrix/singular.ts';
import { compare } from '../../../core/index.ts';
import type { Mesure } from '../../../core/index.ts';

const options = { chauffe: 1, tours: 5, budgetMs: 200 };

/** A line: a single set of inputs, the reference against the foundation or against the previous code. */
export const ligne = <Entree extends ArrayLike<unknown>, Sortie>(
  libelle: string,
  fichier: string | string[],
  name: string,
  input: Entree,
  reference: (input: Entree) => Sortie | Promise<Sortie>,
  optimisee: (input: Entree) => Sortie | Promise<Sortie>,
): Promise<Mesure> =>
  compare({
    name: libelle,
    fichier,
    cas: [{ name, input, size: input.length }],
    reference,
    optimisee,
    options,
  });

/** The yielded value, or the raise code: two sides that raise alike are equal. */
export function essaie<T>(fn: () => T): T | string {
  try {
    return fn();
  } catch (erreur) {
    const e = erreur as { code?: string; message?: string };
    return `raise: ${e.code ?? e.message}`;
  }
}

export const f64 = (e: ArrayLike<number>) => Float64Array.from(e);
export const m4 = (e: ArrayLike<number>) => new THREE.Matrix4().fromArray(e);

const colonne3 = (e: ArrayLike<number>, k: number) => new THREE.Vector3(e[k], e[k + 1], e[k + 2]);

/**
 * The REFERENCE normal matrix, singular-matrix convention included.
 *
 * `Matrix3.getNormalMatrix` yields the NULL matrix as soon as the 3×3 is singular — and NaNs as
 * soon as its raw determinant overflows: a primitive flattened on a plane would lose every
 * normal, while its faces keep an area and an orientation. The engine yields the ADJOINT in
 * that case (`packages/sdk-core/src/math/matrix/matrix3.ts`), that is the cross product of the transformed
 * edges, which shading then normalizes, and nine zeros when the scale is neither finite nor
 * strictly positive. VALUES stay those of the host library where the engine promises parity —
 * `getNormalMatrix` on a regular matrix — and elsewhere those of the host `crossVectors`,
 * which share no line with the foundation. Only the BRANCH comes from the engine's unique
 * rule (`packages/sdk-core/src/math/matrix/singular.ts`): an oracle that judged singularity differently from the judged
 * code would no longer compare the same cases.
 */
export function normaleReference(matrice: THREE.Matrix4): Float64Array {
  const e = matrice.elements;
  const normalise = normalizedLinearDeterminant(e);
  if (Number.isNaN(normalise)) return f64(new Array(9).fill(0));
  const a = colonne3(e, 0),
    b = colonne3(e, 4),
    c = colonne3(e, 8);
  const x = new THREE.Vector3().crossVectors(b, c);
  if (a.dot(x) !== 0 && Math.abs(normalise) > SINGULAR_DETERMINANT)
    return f64(new THREE.Matrix3().getNormalMatrix(matrice).elements);
  const y = new THREE.Vector3().crossVectors(c, a),
    z = new THREE.Vector3().crossVectors(a, b);
  return f64([...x.toArray(), ...y.toArray(), ...z.toArray()]);
}

/** Position, quaternion and scale yielded by the foundation. */
export function trs(m: ArrayLike<number>): [Float64Array, Float64Array, Float64Array] {
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3);
  decomposeMatrix4(m, p, q, s);
  return [p, q, s];
}

/** Position, quaternion and scale yielded by the reference, in the same form. */
export function trsReference(m: THREE.Matrix4): [Float64Array, Float64Array, Float64Array] {
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  m.decompose(p, q, s);
  return [f64(p.toArray()), f64(q.toArray()), f64(s.toArray())];
}
