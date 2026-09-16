import type * as THREE from 'three';
import { maxStretch, multiplyMatrix4 } from '../sdk-core/index.ts';

/**
 * Les vues d'une image, une par matrice monde rencontrée.
 *
 * Une scène porte quelques racines et des milliers de clusters : recalculer `vue × monde` par
 * cluster serait un produit de matrices par cluster. Les vues sont donc retenues par matrice, dans
 * des tampons possédés qui vivent d'une image à l'autre — une image n'alloue rien tant qu'elle ne
 * découvre pas une matrice de plus que la plus chargée avant elle.
 */
export function createFrameViews() {
  const ranks = new Map<THREE.Matrix4, number>();
  const views: Float64Array[] = [];
  const stretches: number[] = [];
  let used = 0;
  return {
    /** Ouvre une image : les vues déjà calculées restent, leur association est refaite. */
    reset() {
      used = 0;
      ranks.clear();
    },
    /** Le rang de la vue de cette matrice, calculée une fois par image. */
    of(matrix: THREE.Matrix4, camView: ArrayLike<number>) {
      const known = ranks.get(matrix);
      if (known !== undefined) return known;
      const at = used++;
      if (views.length <= at) {
        views.push(new Float64Array(16));
        stretches.push(1);
      }
      ranks.set(matrix, at);
      multiplyMatrix4(views[at], camView, matrix.elements);
      stretches[at] = maxStretch(views[at] as unknown as readonly number[]);
      return at;
    },
    view: (at: number) => views[at],
    stretch: (at: number) => stretches[at],
  };
}
