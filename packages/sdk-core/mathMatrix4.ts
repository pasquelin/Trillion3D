/**
 * Matrices 4×4 du socle mathématique : fonctions libres sur des tableaux colonne-major (`m[colonne ·
 * 4 + ligne]`), sortie passée en paramètre, aucune allocation. Le produit et l'inverse suivent terme
 * à terme les formules de la bibliothèque 3D de référence, dans le même ordre d'opérations
 * flottantes : un appel remplacé rend les mêmes bits. `sdk-browser/bench/socle-math.bench.mjs` le
 * prouve, et chiffre l'écart là où une formule du dépôt diffère de la référence.
 */

/** Ce qu'une sortie accepte : `Float32Array`, `Float64Array` ou tableau ordinaire. */
export type NumberSink = { [index: number]: number };

/**
 * `out = a · b`. Les trente-deux entrées sont lues avant la première écriture, donc `out` peut être
 * `a` ou `b`. Chaque terme est la somme de quatre produits, sans zéro initial : une somme commencée
 * à `0` changerait le signe d'un zéro négatif.
 *
 * UN SEUL TYPE DE TAMPON, `Float64Array`, EN ENTRÉE COMME EN SORTIE. Les quarante-huit accès de ce
 * corps sont quarante-huit sites de lecture et d'écriture indexées, partagés par TOUS les appelants :
 * un seul appelant qui passe un `Float32Array` ou un tableau ordinaire les rend polymorphes, et les
 * boucles chaudes — les matrices monde d'une hiérarchie, les lots — le paient ensuite à chaque
 * élément. Les appelants qui partent d'une matrice de la bibliothèque hôte la recopient donc d'abord
 * dans un tampon possédé : seize nombres copiés une fois par racine ou par matrice distincte, contre
 * un site polymorphe pour des milliers de nœuds. La simple précision est une conversion d'ENVOI :
 * elle se fait en recopiant le résultat dans le tampon du GPU, jamais en écrivant ici, et ne change
 * aucun bit — chaque terme est calculé en double puis arrondi une fois, comme avant.
 *
 * Les seize indices d'écriture sont des constantes. Un décalage de sortie en paramètre les rendrait
 * calculés, donc payables d'une addition et d'un contrôle de bornes chacun : mesuré à 6 % du produit
 * entier. Un appelant qui compose dans un grand tampon lui passe une sous-vue, ou compose à part puis
 * recopie ses seize nombres.
 */
export function multiplyMatrix4(out: Float64Array, a: Float64Array, b: Float64Array) {
  const a11 = a[0],
    a12 = a[4],
    a13 = a[8],
    a14 = a[12];
  const a21 = a[1],
    a22 = a[5],
    a23 = a[9],
    a24 = a[13];
  const a31 = a[2],
    a32 = a[6],
    a33 = a[10],
    a34 = a[14];
  const a41 = a[3],
    a42 = a[7],
    a43 = a[11],
    a44 = a[15];
  const b11 = b[0],
    b12 = b[4],
    b13 = b[8],
    b14 = b[12];
  const b21 = b[1],
    b22 = b[5],
    b23 = b[9],
    b24 = b[13];
  const b31 = b[2],
    b32 = b[6],
    b33 = b[10],
    b34 = b[14];
  const b41 = b[3],
    b42 = b[7],
    b43 = b[11],
    b44 = b[15];
  out[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  out[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  out[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  out[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
  out[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  out[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  out[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  out[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
  out[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  out[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  out[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  out[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
  out[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  out[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  out[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  out[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
  return out;
}

/**
 * Déterminant 4×4, développé selon la dernière ligne comme la référence, parenthèses et signes
 * unaires compris. Sur une matrice affine, les trois premiers termes valent `0 · cofacteur`.
 */
export function determinantMatrix4(m: ArrayLike<number>) {
  const n11 = m[0],
    n12 = m[4],
    n13 = m[8],
    n14 = m[12];
  const n21 = m[1],
    n22 = m[5],
    n23 = m[9],
    n24 = m[13];
  const n31 = m[2],
    n32 = m[6],
    n33 = m[10],
    n34 = m[14];
  const n41 = m[3],
    n42 = m[7],
    n43 = m[11],
    n44 = m[15];
  return (
    n41 *
      (+n14 * n23 * n32 -
        n13 * n24 * n32 -
        n14 * n22 * n33 +
        n12 * n24 * n33 +
        n13 * n22 * n34 -
        n12 * n23 * n34) +
    n42 *
      (+n11 * n23 * n34 -
        n11 * n24 * n33 +
        n14 * n21 * n33 -
        n13 * n21 * n34 +
        n13 * n24 * n31 -
        n14 * n23 * n31) +
    n43 *
      (+n11 * n24 * n32 -
        n11 * n22 * n34 -
        n14 * n21 * n32 +
        n12 * n21 * n34 +
        n14 * n22 * n31 -
        n12 * n24 * n31) +
    n44 *
      (-n13 * n22 * n31 -
        n11 * n23 * n32 +
        n11 * n22 * n33 +
        n13 * n21 * n32 -
        n12 * n21 * n33 +
        n12 * n23 * n31)
  );
}

/**
 * Déterminant de la seule partie linéaire (le bloc 3×3 des colonnes 0, 1 et 2) d'une matrice 4×4,
 * développé selon la première colonne. Son signe dit si la transformation renverse l'orientation,
 * donc quelle face un dessin doit éliminer. Ce n'est pas le développement de `determinantMatrix4` :
 * l'écart relatif est de quelques ulps, et le signe ne peut différer qu'au voisinage d'une matrice
 * singulière, où aucun des deux arrondis ne décide. Le banc chiffre les deux.
 */
export function linearPartDeterminant(m: ArrayLike<number>) {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

/** L'identité colonne-major, lue et jamais écrite : la pose d'un nœud ou d'une racine sans pose. */
export const IDENTITY_MATRIX4: Float64Array = new Float64Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/**
 * Recopie les seize flottants de `m` dans `out`, chacun à son décalage. Une boucle plutôt que
 * `TypedArray.prototype.set` : sur une vue, `set` coûte un appel natif, et les sorties ne sont pas
 * toutes typées (matrices de l'hôte, tampons GPU en simple précision — la seule conversion, ici).
 */
export function copyMatrix4(out: NumberSink, m: ArrayLike<number>, outAt = 0, mAt = 0) {
  for (let i = 0; i < 16; i++) out[outAt + i] = m[mAt + i];
}
