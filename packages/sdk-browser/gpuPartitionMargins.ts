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
 * Ce que coûte l'arrondi des ENTRÉES du produit scalaire, rapporté à la magnitude monde des coins.
 *
 * Les coins et l'ancre voyagent chacun en DEUX simples précisions, si bien que tous deux
 * représentent leur double d'origine à `u²` près. L'écart `d = (coinHaut − ancreHaut) + (coinBas −
 * ancreBas)` ne fait plus alors que trois arrondis, chacun majoré par `u|d|` : l'écart d'entrée
 * d'une coordonnée est donc majoré par `3u|d|`, et sa part dans un produit scalaire par
 * `Σ|m_i| · 3u|d_i|`. Le noyau prend **quatre** `u` : la marge couvre les termes du second ordre.
 *
 * La magnitude monde a disparu de cette borne, et c'est tout l'objet de l'ancrage. Un coin porté par
 * un seul flottant vaudrait `x(1 ± u)`, et sur un modèle urbain — coordonnées à cinq chiffres,
 * caméra dans la rue — cette seule erreur-là élargissait le rectangle conservateur de plusieurs
 * texels, jusqu'à retirer au test d'occultation tout pouvoir de rejet. Relativement à la caméra et
 * en double mot, les termes sont de l'ordre de la taille du cluster, et la borne aussi.
 */
export const INPUT_K = 4 * U;

/**
 * Ce que coûte le seul passage du repère normalisé à l'écran, en texels, rapporté au plus grand
 * côté de la cible : `(v·0,5+0,5)·côté` et `(1−(v·0,5+0,5))·côté` ne font que trois arrondis
 * simples, et la soustraction à 1 borne son propre écart par `2u`. Quatre `u` couvrent les deux.
 * L'erreur portée par `v` lui-même est déjà entrée dans `v` avant cette conversion.
 */
export const SCREEN_SLACK_K = 4 * U;

/**
 * Le facteur qui ÉLÈVE la borne de profondeur avant qu'elle ne voyage jusqu'au noyau.
 *
 * La profondeur du moteur est inversée : une boîte n'est rejetée que si sa borne la plus proche est
 * PLUS PETITE que l'occulteur, donc une borne conservatrice est une borne qui MAJORE ce que le
 * cluster écrira — l'opposé du sens qu'elle avait en profondeur directe. Deux ulps de marge : le
 * premier rattrape l'arrondi au plus proche du transport, le second est celui que `hizNearestBound`
 * applique déjà en double précision. La multiplication en simple précision est monotone, donc une
 * entrée supérieure ou égale à celle du processeur rend une sortie supérieure ou égale à la sienne.
 */
export const DEPTH_GROW = (1 + 2 ** -23) * (1 + U);

/** Un littéral WGSL `f32` qui porte tous les chiffres significatifs de la constante. */
export const wgslFloat = (value: number) => {
  const text = value.toPrecision(12);
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
};
