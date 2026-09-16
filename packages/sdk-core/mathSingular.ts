/**
 * LA RÈGLE « MATRICE SINGULIÈRE » DU MOTEUR, écrite une fois, pour le processeur ET pour la carte.
 *
 * LE FAIT. Une transformation est singulière quand elle écrase l'espace : son déterminant s'annule.
 * Le tester sur le déterminant BRUT ne dit rien, parce qu'un déterminant porte l'échelle au cube.
 * Une rotation d'échelle uniforme `s` a pour déterminant ±s³ : à `s = 1e-7`, parfaitement régulière,
 * le déterminant brut vaut 1e-21 et passe sous n'importe quel seuil absolu ; à `s = 1e7`, tout aussi
 * régulière, il vaut 1e21. Un seuil absolu juge donc l'échelle, jamais la dégénérescence.
 *
 * LA RÈGLE, en une phrase. La partie linéaire est divisée par la somme des valeurs absolues de ses
 * neuf termes — son échelle — AVANT le déterminant ; elle est singulière quand ce déterminant
 * normalisé ne dépasse pas `SINGULAR_DETERMINANT`. Une échelle nulle, infinie ou NaN est singulière :
 * la division ne rend alors plus rien.
 *
 * OÙ ELLE S'APPLIQUE. `normalMatrix3` (`mathMatrix3.ts`) côté processeur, `invTranspose3Prep`
 * (`packages/sdk-browser/inverseTransposeWgsl.ts`) côté carte, qui insère `SINGULAR_DETERMINANT_WGSL`
 * dans son texte au lieu de réécrire le nombre. Les deux décident de la même chose, chacun dans sa
 * précision : le processeur en double, la carte en simple. Ce qu'une matrice singulière DEVIENT — la
 * convention des normales aplaties — est écrit une seule fois, dans `inverseTransposeWgsl.ts`.
 *
 * CE QU'ELLE NE COUVRE PAS. `invertMatrix4` (`mathMatrix4Inverse.ts`) est l'inverse 4×4 complet, tenu
 * aux bits de la bibliothèque 3D de référence, seuil `det === 0` compris ; il ne transporte aucune
 * normale, et son contrat est la parité avec la référence, pas cette règle.
 */

/**
 * Le seuil, sur le déterminant NORMALISÉ. Sous 1e-12, le cube d'une échelle devient dénormal en
 * simple précision : seule la normalisation franchit ce plancher, et ce seuil-ci ne juge donc plus
 * que la forme de la matrice, jamais sa taille.
 */
export const SINGULAR_DETERMINANT = 1e-20;

/** Le seuil tel que le WGSL l'écrit, rendu depuis la constante : un seul nombre, deux langages. */
export const SINGULAR_DETERMINANT_WGSL = SINGULAR_DETERMINANT.toExponential();

/**
 * L'ÉCHELLE d'une partie linéaire : la somme des valeurs absolues des neuf termes du bloc 3×3 d'une
 * 4×4 colonne-major. C'est le diviseur de la normalisation, et la même somme que le test de
 * conformité lit (`packages/sdk-browser/pageCone.ts`) : une seule somme, un seul ordre de termes.
 */
export function linearPartScale(m: ArrayLike<number>) {
  return (
    Math.abs(m[0]) +
    Math.abs(m[1]) +
    Math.abs(m[2]) +
    Math.abs(m[4]) +
    Math.abs(m[5]) +
    Math.abs(m[6]) +
    Math.abs(m[8]) +
    Math.abs(m[9]) +
    Math.abs(m[10])
  );
}

/**
 * Le déterminant de la partie linéaire NORMALISÉE, dans l'ordre du noyau WGSL : les trois colonnes
 * divisées par l'échelle, puis `a · (b × c)`. Les colonnes sont divisées AVANT le produit, jamais le
 * déterminant brut divisé par le cube de l'échelle : `t³` déborde au-delà de 1e103 et s'annule sous
 * 1e-103, c'est-à-dire exactement là où cette règle est censée décider. Une échelle nulle, infinie
 * ou NaN rend `NaN`, qu'aucune comparaison `> seuil` n'accepte.
 */
export function normalizedLinearDeterminant(m: ArrayLike<number>) {
  const t = linearPartScale(m);
  if (!(t > 0) || !Number.isFinite(t)) return NaN;
  const a0 = m[0] / t,
    a1 = m[1] / t,
    a2 = m[2] / t;
  const b0 = m[4] / t,
    b1 = m[5] / t,
    b2 = m[6] / t;
  const c0 = m[8] / t,
    c1 = m[9] / t,
    c2 = m[10] / t;
  return a0 * (b1 * c2 - b2 * c1) + a1 * (b2 * c0 - b0 * c2) + a2 * (b0 * c1 - b1 * c0);
}

/**
 * LA DÉCISION, dans la forme même du noyau WGSL (`invTranspose3Prep`) : le facteur qui multiplie
 * l'adjointe de la partie linéaire.
 *
 *  — `1 / determinant`, la matrice est RÉGULIÈRE : l'inverse-transposée, aux bits de la référence.
 *    Le déterminant passé est le déterminant BRUT que l'appelant a déjà ; seule la décision lit le
 *    déterminant normalisé, si bien qu'une matrice régulière rend exactement ce qu'elle rendait.
 *  — `1`, la matrice est SINGULIÈRE : l'adjointe telle quelle, sans facteur — il vaudrait ±∞. C'est
 *    le produit vectoriel des arêtes transformées, à un facteur positif près que le consommateur
 *    efface en normalisant. Un déterminant brut EXACTEMENT NUL tombe ici aussi, même quand la forme
 *    est régulière : la somme de ses six produits peut s'annuler par compensation là où la version
 *    normalisée, elle, ne s'annule pas, et un diviseur nul ne rend rien d'exploitable. C'est le cas
 *    que le moteur traitait déjà ainsi, à l'adjointe près, et il reste traité ainsi — la carte, qui
 *    divise par le déterminant NORMALISÉ, n'a pas ce cas et rend alors l'inverse-transposée.
 *  — `null`, l'échelle n'est ni finie ni strictement positive : l'adjointe elle-même ne vaut plus
 *    rien et doit être REMPLACÉE par zéro, comme `select(z, cross(…), fini)` du noyau. Un terme NaN
 *    ne se corrige pas en le multipliant par zéro, d'où le `null` plutôt qu'un facteur nul.
 */
export function adjugateFactor(m: ArrayLike<number>, determinant: number) {
  const normalized = normalizedLinearDeterminant(m);
  if (Number.isNaN(normalized)) return null;
  if (determinant === 0 || !(Math.abs(normalized) > SINGULAR_DETERMINANT)) return 1;
  return 1 / determinant;
}
