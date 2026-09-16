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

const colonne3 = (e, k) => new THREE.Vector3(e[k], e[k + 1], e[k + 2]);

/**
 * La matrice des normales de la RÉFÉRENCE, convention des faces aplaties comprise.
 *
 * `Matrix3.getNormalMatrix` rend la matrice NULLE dès que la 3×3 est singulière : une primitive
 * écrasée sur un plan y perdrait toute normale, alors que ses faces gardent une aire et une
 * orientation. Le moteur rend l'ADJOINTE dans ce cas (`packages/sdk-core/mathMatrix3.ts`), c'est à
 * dire le produit vectoriel des arêtes transformées, que l'ombrage normalise ensuite. Cette écriture
 * dit la même convention avec les `crossVectors` et le `dot` de la bibliothèque hôte, sur les trois
 * colonnes de la 3×3 : elle ne partage aucune ligne avec le socle, et le déterminant qu'elle teste
 * est celui-là même que le socle calcule — `a · (b × c)`, mêmes produits, même ordre, même zéro.
 */
export function normaleReference(matrice) {
  const e = matrice.elements;
  const a = colonne3(e, 0),
    b = colonne3(e, 4),
    c = colonne3(e, 8);
  const x = new THREE.Vector3().crossVectors(b, c);
  if (a.dot(x) !== 0) return f64(new THREE.Matrix3().getNormalMatrix(matrice).elements);
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
