/**
 * Les marges qui rendent la projection GPU conservatrice, et d'où elles sortent.
 *
 * `u = 2⁻²⁴` est le demi-ulp relatif de la simple précision : un arrondi au plus proche déplace une
 * valeur d'au plus `u` fois elle-même.
 */
const U = 2 ** -24;

/**
 * Le facteur qui majore l'erreur d'un produit scalaire de quatre termes, rapporté à la somme des
 * valeurs absolues de ces termes.
 *
 * Chaque terme `m·x` porte l'arrondi de `m`, celui de `x` et celui du produit, soit `3u` relatifs ;
 * les trois additions qui les somment ajoutent au plus `3u · Σ|termes|`. L'écart total est donc
 * majoré par `6u · Σ|termes|`, aux termes du second ordre près. Le noyau prend **huit** : la marge
 * couvre ces termes, et une contraction en FMA — que le compilateur WGSL peut faire — ne peut que
 * diminuer l'erreur réelle, jamais l'augmenter au-delà de cette borne.
 */
export const ERR_K = 8 * U;

/**
 * Ce que coûte le seul passage du repère normalisé à l'écran, en texels, rapporté au plus grand
 * côté de la cible : `(v·0,5+0,5)·côté` et `(1−(v·0,5+0,5))·côté` ne font que trois arrondis
 * simples, et la soustraction à 1 borne son propre écart par `2u`. Quatre `u` couvrent les deux.
 * L'erreur portée par `v` lui-même est déjà entrée dans `v` avant cette conversion.
 */
export const SCREEN_SLACK_K = 4 * U;

/**
 * Le facteur qui descend la borne de profondeur avant qu'elle ne voyage jusqu'au noyau.
 *
 * Deux ulps : le premier rattrape l'arrondi au plus proche de la conversion `(lowZ·0,5+0,5)`, qui
 * peut faire MONTER la valeur d'un demi-ulp, le second est le `SHRINK` que `hizNearestBound`
 * applique déjà en double précision. La multiplication en simple précision est monotone, donc une
 * entrée inférieure ou égale à celle du processeur rend une sortie inférieure ou égale à la sienne.
 */
export const DEPTH_SHRINK = (1 - 2 ** -23) * (1 - U);

/** Un littéral WGSL `f32` qui porte tous les chiffres significatifs de la constante. */
export const wgslFloat = (value: number) => {
  const text = value.toPrecision(12);
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
};
