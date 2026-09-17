import { maxStretch } from '../sdk-core/index.ts';
import { FRAME_VEC4, type PackedDag } from './gpuDagTypes.ts';

/**
 * Rangs de la partie linéaire d'une matrice monde rangée en colonnes, et seuls rangs que `maxStretch`
 * lit (`projectionOracles.ts`). La translation — rangs 12 à 14 — n'en est pas, et la dernière ligne
 * non plus.
 */
const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10];

/**
 * L'étirement objet → vue des primitives dont la partie linéaire a bougé, recalculé pour elles
 * seules ; rend leur nombre.
 *
 * Le repère de rendu suit l'œil : à chaque pas de la caméra, les seize flottants de chaque matrice
 * monde sont réécrits alors que seule leur translation change. L'étirement ne dépend pourtant que des
 * neuf coefficients linéaires — `maxStretch` ne lit qu'eux —, si bien qu'une origine déplacée le
 * recalculait pour redonner exactement le même flottant, puis faisait repousser tout le tampon des
 * cadres. Zéro rendu ici veut dire « aucun étirement n'a changé » : le tampon n'a rien à recevoir.
 */
export function refreshWorldStretch(
  previous: Float32Array,
  next: Float32Array,
  packed: Pick<PackedDag, 'worldCount' | 'worldStretch'>,
  frameData: Float32Array,
) {
  let count = 0;
  for (let w = 0; w < packed.worldCount; w++) {
    const base = w * 16;
    let stretched = false;
    for (let k = 0; k < LINEAR.length; k++)
      if (previous[base + LINEAR[k]] !== next[base + LINEAR[k]]) {
        stretched = true;
        break;
      }
    if (!stretched) continue;
    count++;
    const stretch = maxStretch(next.subarray(base, base + 16));
    packed.worldStretch[w] = stretch;
    frameData[(w * FRAME_VEC4 + 6) * 4] = stretch;
  }
  return count;
}
