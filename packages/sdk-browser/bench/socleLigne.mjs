// Les outils partagés des lignes d'équivalence du socle : une ligne du tableau commun, la capture d'une
// levée, et la décomposition TRS lue des deux côtés dans la même forme.
import * as THREE from 'three';
import { decomposeMatrix4 } from '../../sdk-core/index.ts';
import { compare } from '../../sdk-core/bench/banc.mjs';

const options = { chauffe: 1, tours: 5, budgetMs: 200 };

/** Une ligne : un seul jeu d'entrées, la référence contre le socle ou contre le code d'avant. */
export const ligne = (calcul, fichier, nom, entree, reference, optimisee) =>
  compare({
    calcul,
    fichier,
    cas: [{ nom, entree, taille: entree.length }],
    reference,
    optimisee,
    options,
  });

/** La valeur rendue, ou le code de la levée : deux côtés qui lèvent pareil sont égaux. */
export function essaie(fn) {
  try {
    return fn();
  } catch (erreur) {
    return `levée : ${erreur.code ?? erreur.message}`;
  }
}

export const f64 = (e) => Float64Array.from(e);
export const m4 = (e) => new THREE.Matrix4().fromArray(e);

/** Position, quaternion et échelle rendus par le socle. */
export function trs(m) {
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3);
  decomposeMatrix4(m, p, q, s);
  return [p, q, s];
}

/** Position, quaternion et échelle rendus par la référence, dans la même forme. */
export function trsReference(m) {
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  m.decompose(p, q, s);
  return [f64(p.toArray()), f64(q.toArray()), f64(s.toArray())];
}
