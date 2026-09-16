import type { NumberSink } from './mathMatrix4.ts';

/**
 * LE REPÈRE DE RENDU. Une scène posée loin de l'origine du monde tremble : la carte graphique
 * compose `vue · monde` en simple précision, et deux nombres de l'ordre de 50 km qui s'annulent
 * presque n'y laissent que quelques millimètres de chiffres justes. À chaque image la caméra bouge
 * un peu, l'annulation ne tombe pas au même endroit, et la surface frissonne.
 *
 * LA RÈGLE. Le processeur travaille en double précision, où 50 km laissent encore le micromètre :
 * c'est donc lui, et lui seul, qui retire la position de l'œil. La vue perd sa translation, chaque
 * matrice monde voit la sienne ramenée à l'œil, et le produit `vueRelative · mondeRelatif` vaut,
 * en arithmétique exacte, le `vue · monde` d'avant — la soustraction s'y simplifie terme à terme.
 * Ce qui part en simple précision ne porte alors plus que des nombres de la taille de la scène
 * VISIBLE, et non de sa distance à l'origine : le tremblement disparaît.
 *
 * LA CONTRAINTE. Une formule change de repère entière ou pas du tout : un opérande relatif et un
 * opérande absolu dans la même somme est un défaut, jamais une approximation. Une position monde
 * qui reste en double précision côté processeur n'a, elle, rien à changer.
 *
 * L'ORIGINE est la position de l'œil de l'image, et rien d'autre. Caméra à l'origine du monde, la
 * soustraction rend les mêmes bits qu'aucune soustraction : l'image ne change pas.
 */

/**
 * Écrit `world` avec sa translation ramenée à `origin`. La soustraction se fait dans la précision
 * des entrées — le double des matrices monde du moteur — et l'écriture d'un tampon simple précision
 * arrondit APRÈS elle, jamais avant : c'est tout ce qui sépare une image nette d'une image qui
 * frissonne. `at` est le rang du premier des seize nombres écrits, pour qu'un tampon de plusieurs
 * matrices se remplisse sans en découper une vue par matrice et par image.
 */
export function worldToRenderOrigin<T extends NumberSink>(
  out: T,
  world: ArrayLike<number>,
  origin: ArrayLike<number>,
  at = 0,
) {
  for (let i = 0; i < 16; i++) out[at + i] = world[i];
  out[at + 12] = world[12] - origin[0];
  out[at + 13] = world[13] - origin[1];
  out[at + 14] = world[14] - origin[2];
  return out;
}

/**
 * Écrit `view` sans sa translation : la vue d'une caméra de même orientation posée à l'origine du
 * repère de rendu. C'est l'exacte contrepartie de `worldToRenderOrigin` — la translation de la vue
 * est l'image de l'œil par la partie linéaire, et le monde relatif la porte déjà.
 */
export function viewToRenderOrigin<T extends NumberSink>(out: T, view: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) out[i] = view[i];
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  return out;
}
