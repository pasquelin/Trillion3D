import type { LocaleOverlay } from './entryOverlay.ts';

export const matrixFr: LocaleOverlay = {
  multiplyMatrix4: {
    description:
      '`out = a · b`. Les trente-deux entrées sont lues avant la première écriture ; `out` peut donc être `a` ou `b`. Chaque terme additionne quatre produits sans zéro initial afin de préserver le signe de zéro. Entrées et sortie utilisent uniquement `Float64Array`.',
  },
  invertMatrix4: {
    description:
      '`out = m⁻¹` par cofacteurs. Un déterminant exactement nul produit la matrice nulle, comme la référence. Les seize entrées sont lues avant la première écriture ; `out` peut donc être `m`.',
  },
  composeMatrix4: {
    description:
      '`out = T · R · S`, quaternion ordonné `(x, y, z, w)`. La dernière ligne est exactement `(0, 0, 0, 1)` et les produits du quaternion sont doublés par addition, comme la référence.',
  },
  decomposeMatrix4: {
    description:
      'Opération inverse : l’échelle d’une colonne est sa longueur et un déterminant négatif est porté uniquement par l’axe `x`. Une matrice cisaillée n’a pas cette décomposition ; la recomposition ne redonne alors plus `m`, comme dans la référence.',
  },
  copyMatrix4: {
    description:
      'Copie les seize nombres de `m` vers `out` à leurs décalages. Une boucle évite le coût natif de `TypedArray.set` sur une vue et accepte aussi un tampon GPU simple précision.',
  },
  determinantMatrix4: {
    description:
      'Le déterminant 4×4, développé sur la dernière ligne comme la référence, puis celui de la partie linéaire 3×3. Le signe du second indique si la transformation inverse l’orientation et donc quelle face éliminer.',
  },
  normalMatrix3: {
    description:
      '`out = transpose(inverse(bloc 3×3 de m))`, en ordre colonne. Sur une matrice singulière, écrit l’adjointe non divisée : elle transporte encore la normale de la surface aplatie. Une échelle nulle ou non finie produit neuf zéros.',
  },
  linearPartScale: {
    description:
      'Règle unique de singularité du moteur, identique au noyau WGSL. Les colonnes sont divisées par leur échelle avant le déterminant pour éviter débordement et sous-flux. `adjugateFactor` renvoie l’inverse du déterminant, 1 pour un cas singulier, ou `null` si l’échelle est invalide.',
  },
  basisMatrix4: {
    description:
      'Écrit les colonnes `u`, `v`, `n`, puis l’origine et la dernière ligne `(0, 0, 0, 1)` ; ou une échelle uniforme `s` placée en `center`. Chaque fonction remplace deux appels de la bibliothèque hôte par une seule écriture.',
  },
};
