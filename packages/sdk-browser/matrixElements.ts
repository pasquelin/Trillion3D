import { IDENTITY_MATRIX4, copyMatrix4 } from '../sdk-core/index.ts';

/**
 * Les seize flottants d'une matrice, comparés ou recopiés : savoir si la vue a bougé, ou si la pose
 * demandée est celle qu'un nœud porte déjà. Chaque lecteur écrivait sa propre boucle ; ils lisent
 * tous la même arithmétique, au flottant près et sans tolérance.
 */
export function sameElements(held: ArrayLike<number>, now: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) if (held[i] !== now[i]) return false;
  return true;
}

/**
 * Dans les deux sens : une matrice de l'HÔTE recopiée dans un tampon possédé, ou un résultat du
 * socle posé dans une matrice de l'hôte. Le socle ne calcule que dans des `Float64Array` — un seul
 * type de tampon pour le produit et l'inverse (`mathMatrix4.ts`) — et les matrices de la
 * bibliothèque hôte sont des tableaux ordinaires : un résultat destiné à l'hôte se compose donc à
 * part, puis se recopie ici.
 */
export function copyElements(into: { [index: number]: number }, from: ArrayLike<number>) {
  copyMatrix4(into, from);
}

/**
 * Une matrice 4×4 colonne-major que l'HÔTE possède — la pose d'un nœud de sa scène. Le moteur n'en
 * lit que les seize flottants : aucune structure de la bibliothèque hôte ne traverse une signature.
 */
export type MatrixElements = { readonly elements: ArrayLike<number> };

export { IDENTITY_MATRIX4 as IDENTITY_ELEMENTS };
