/**
 * Les seize flottants d'une matrice, comparés ou recopiés : savoir si la vue a bougé, ou si la pose
 * demandée est celle qu'un nœud porte déjà. Chaque lecteur écrivait sa propre boucle ; ils lisent
 * tous la même arithmétique, au flottant près et sans tolérance.
 */
export function sameElements(held: ArrayLike<number>, now: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) if (held[i] !== now[i]) return false;
  return true;
}

export function copyElements(held: Float64Array, now: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) held[i] = now[i];
}

/**
 * Une matrice 4×4 colonne-major que l'HÔTE possède — la pose d'un nœud de sa scène. Le moteur n'en
 * lit que les seize flottants : aucune structure de la bibliothèque hôte ne traverse une signature.
 */
export type MatrixElements = { readonly elements: ArrayLike<number> };

/** L'identité colonne-major, lue et jamais écrite : la transformation d'une racine sans pose. */
export const IDENTITY_ELEMENTS: Float64Array = new Float64Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);
