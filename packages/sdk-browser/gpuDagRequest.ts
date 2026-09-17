/**
 * La DEMANDE DE DIFFUSION : ce qu'une image fait redescendre de la carte pour que l'hôte sache quoi
 * charger, et dans quel ordre.
 *
 * La coupe ordonnait ses rangs par un compteur atomique, donc par rien : l'hôte téléversait dans
 * l'ordre où les fils avaient gagné la course. Le chemin WebGL2, lui, classe depuis toujours par
 * l'ERREUR D'ÉCRAN DU REMPLAÇANT (`streamingPriority.ts`, `orderPendingUrls`) — une grappe absente
 * est dessinée par un ancêtre plus grossier, et l'erreur de cet ancêtre est exactement ce que
 * l'œil voit : c'est elle qui décide qui arrive d'abord. La carte porte maintenant la même valeur,
 * calculée par la même formule (`projected`, miroir prouvé de `clusterErrorPixels`).
 *
 * Un MOT par demande, pour que la copie d'image reste ce qu'elle est : la page dans les 22 bits
 * bas — 4 194 304 grappes, contre 1 959 792 sur la plus grosse scène mesurée —, la priorité
 * quantifiée dans les 10 hauts. La quantification est LOGARITHMIQUE et monotone : elle ne sert qu'à
 * ordonner, et un pas relatif constant garde autant de finesse sur une erreur d'un pixel que sur une
 * erreur de mille. Deux erreurs voisines peuvent tomber dans le même pas — l'ordre entre elles est
 * alors indifférent, comme il l'est chez la référence, qui ne départage pas non plus.
 */
export const REQUEST_PAGE_BITS = 22;
export const REQUEST_PAGE_MAX = 1 << REQUEST_PAGE_BITS;
export const REQUEST_PRIORITY_MAX = 1023;
/** Pas de la quantification : seize pas par doublement de l'erreur, sur soixante-quatre doublements. */
export const REQUEST_PRIORITY_SCALE = 16;

/** La priorité d'une erreur en pixels, monotone croissante et bornée. `Infinity` prend le plus haut
 *  pas : une grappe que rien ne remplace est ce qui manque le plus. */
export function quantizeRequestPriority(pixels: number) {
  if (!(pixels > 0)) return 0;
  if (!Number.isFinite(pixels)) return REQUEST_PRIORITY_MAX;
  const pas = Math.round(Math.log2(1 + pixels) * REQUEST_PRIORITY_SCALE);
  return Math.min(REQUEST_PRIORITY_MAX, Math.max(0, pas));
}

export const packRequest = (page: number, priority: number) =>
  ((priority << REQUEST_PAGE_BITS) | page) >>> 0;
export const requestPage = (word: number) => word & (REQUEST_PAGE_MAX - 1);
export const requestPriority = (word: number) => word >>> REQUEST_PAGE_BITS;

/**
 * Miroir WGSL, au bit près. `log2` de WGSL et `Math.log2` de JavaScript ne rendent pas forcément le
 * même dernier bit, et l'arrondi peut donc séparer deux pas voisins : l'ordre publié reste celui des
 * erreurs, la frontière entre deux pas seule est flottante. C'est pourquoi la preuve compare des
 * ORDRES et non des mots.
 */
export const DAG_REQUEST_WGSL = `const PAGE_BITS:u32=${REQUEST_PAGE_BITS}u;
fn quantizePriority(pixels:f32)->u32{
 if(!(pixels>0.0)){return 0u;}
 if(pixels>=INF){return ${REQUEST_PRIORITY_MAX}u;}
 let pas=i32(round(log2(1.0+pixels)*${REQUEST_PRIORITY_SCALE}.0));
 return u32(clamp(pas,0,${REQUEST_PRIORITY_MAX}));
}
fn packRequest(page:u32,priority:u32)->u32{return (priority<<PAGE_BITS)|page;}
`;
