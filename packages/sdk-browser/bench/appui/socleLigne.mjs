// Les outils partagés des lignes d'équivalence du socle : une ligne du tableau commun, la capture d'une
// levée, et la décomposition TRS lue des deux côtés dans la même forme.
import * as THREE from 'three';
import { decomposeMatrix4 } from '../../../sdk-core/index.ts';
import {
  SINGULAR_DETERMINANT,
  normalizedLinearDeterminant,
} from '../../../sdk-core/mathSingular.ts';
import { compare } from '../../../sdk-core/bench/socle.mjs';

const options = { chauffe: 1, tours: 5, budgetMs: 200 };

/** Une ligne : un seul jeu d'entrées, la référence contre le socle ou contre le code d'avant. */
export const ligne = (libelle, fichier, nom, entree, reference, optimisee) =>
  compare({
    nom: libelle,
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

const colonne3 = (e, k) => new THREE.Vector3(e[k], e[k + 1], e[k + 2]);

/**
 * La matrice des normales de la RÉFÉRENCE, convention des matrices singulières comprise.
 *
 * `Matrix3.getNormalMatrix` rend la matrice NULLE dès que la 3×3 est singulière — et des NaN dès que
 * son déterminant brut déborde : une primitive écrasée sur un plan y perdrait toute normale, alors
 * que ses faces gardent une aire et une orientation. Le moteur rend l'ADJOINTE dans ce cas
 * (`packages/sdk-core/mathMatrix3.ts`), c'est à dire le produit vectoriel des arêtes transformées,
 * que l'ombrage normalise ensuite, et neuf zéros quand l'échelle n'est ni finie ni strictement
 * positive. Les VALEURS restent celles de la bibliothèque hôte là où le moteur promet la parité —
 * `getNormalMatrix` sur une matrice régulière —, et ailleurs celles des `crossVectors` de l'hôte,
 * qui ne partagent aucune ligne avec le socle. Seule la BRANCHE vient de la règle unique du moteur
 * (`mathSingular.ts`) : un oracle qui jugerait la singularité autrement que le code jugé ne
 * comparerait plus les mêmes cas.
 */
export function normaleReference(matrice) {
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
