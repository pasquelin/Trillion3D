/**
 * LA CONVENTION DE PROFONDEUR DU MOTEUR : UNE SEULE, INVERSÉE, PLAN LOINTAIN INFINI.
 *
 * LE FAIT. La profondeur normalisée du moteur va de 1 au plan proche à 0 à l'infini, et elle ne
 * dépend plus de la caméra hôte : `readCameraWorld` ne recopie plus la matrice de projection de
 * l'hôte, il en compose une avec `perspectiveProjection` (sdk-core/mathCamera.ts), dont la ligne de
 * profondeur ne contient aucun plan lointain — `ndc = near / distance`. Il n'y a donc plus deux
 * conventions à réconcilier : il n'y en a qu'une, et ce fichier en est le domicile.
 *
 * POURQUOI. Une profondeur en simple précision porte ses bits près de zéro et la division
 * perspective les porte près du plan proche ; les mettre tête-bêche les répartit. Deux points
 * séparés d'un mètre à un million d'unités gardent alors des profondeurs distinctes, là où la
 * convention directe les écrasait sur la même valeur.
 *
 * CE QUE CE FICHIER TRANCHE, et que personne d'autre ne redécide :
 *  - la comparaison de profondeur des pipelines (`DEPTH_COMPARE`) et des atlas d'ombre ;
 *  - la valeur d'effacement d'une cible de profondeur (`DEPTH_CLEAR`), qui est le lointain ;
 *  - le sens des extrema : ce qu'est « plus proche » (`depthNearer`), donc le sens de la réduction
 *    Hi-Z, qui garde le PLUS LOINTAIN d'un carré, donc le MINIMUM ;
 *  - la conversion d'une profondeur normalisée en distance à l'œil (`depthDistance`) et l'inverse.
 *
 * CE QUI NE CHANGE PAS. Les abscisses et les ordonnées normalisées valent `[−1, 1]` et leur passage
 * à l'écran ne dépend de rien d'ici. Le chemin WebGL2 de l'hôte, lui, dessine avec la projection de
 * la bibliothèque hôte, en profondeur DIRECTE : il signe lui-même le décalage de couche coplanaire
 * (`clusterBatchLayers.ts`) et ne lit rien de ce fichier.
 */

/** La comparaison de profondeur de tous les pipelines : en profondeur inversée, le plus grand gagne. */
export const DEPTH_COMPARE: GPUCompareFunction = 'greater';

/** Profondeur du plan proche. Rien ne peut être plus proche. */
export const DEPTH_NEAR = 1;

/**
 * Profondeur du lointain, donc la valeur d'effacement d'une cible de profondeur et le fond des
 * tampons de profondeur logiciels. Avec le plan lointain infini, aucune surface ne l'atteint.
 */
export const DEPTH_CLEAR = 0;

/** `a` est-il strictement plus proche de l'œil que `b` ? Le seul endroit qui le dise. */
export function depthNearer(a: number, b: number) {
  return a > b;
}

/**
 * La distance à l'œil d'une profondeur normalisée, `near` étant le plan proche de la projection :
 * `ndc = near / distance`, donc `distance = near / ndc`. Une profondeur nulle — le lointain — rend
 * l'infini, ce qu'elle décrit. La formule est sa propre inverse : la même fonction rend la
 * profondeur normalisée d'un point à `distance` de l'œil.
 */
export function depthDistance(depth: number, near: number) {
  return near / depth;
}

/**
 * Une vue-projection et rien d'autre : ce qu'un lecteur de profondeur a besoin de connaître d'une
 * caméra. Une `EngineCamera` en est une. Le type survit à la disparition des deux conventions parce
 * qu'un oracle peut monter une vue-projection sans monter une caméra entière ; c'est un tampon
 * possédé, comme partout où le socle multiplie des matrices (`mathMatrix4.ts`).
 */
export type DepthCamera = { viewProjection: Float64Array };
