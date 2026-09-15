import type * as THREE from 'three';
import { triangleAt } from './visibilityMath.ts';
import {
  unpackVisibilityId,
  visMaterial,
  type VisMaterial,
  type VisPage,
} from './visibilityTypes.ts';

export type VisTriangle = NonNullable<ReturnType<typeof triangleAt>>;

/**
 * Ce qu'une image doit projeter et décrire une seule fois.
 *
 * Un identifiant de visibilité désigne un triangle d'une page, et rien d'autre : ses trois sommets
 * projetés ne dépendent que de la caméra de l'image. Les projeter à chaque pixel refait le même
 * calcul des centaines de fois par triangle — le cache en garde le résultat, terme pour terme celui
 * que `triangleAt` rend, donc le pixel voit exactement les mêmes flottants. Le dernier identifiant
 * est retenu à part : deux pixels voisins tombent presque toujours sur le même triangle, et la table
 * n'est alors même pas consultée. `visMaterial` est mémorisé par page, pour la même raison.
 */
export function createVisibilityFrame(
  pages: VisPage[],
  viewProj: THREE.Matrix4,
  width: number,
  height: number,
) {
  const triangles = new Map<number, VisTriangle | null>(),
    materiaux = new Map<VisPage, VisMaterial>();
  let dernierId = 0,
    dernier: VisTriangle | null = null;
  return {
    /** Le triangle projeté d'un identifiant, ou `null` : fond, page absente ou triangle hors page. */
    triangle(id: number) {
      if (id === dernierId) return dernier;
      dernierId = id;
      const connu = triangles.get(id);
      if (connu !== undefined) return (dernier = connu);
      const unpacked = unpackVisibilityId(id);
      const page = unpacked ? pages[unpacked.pageIndex] : undefined;
      const triangle =
        page && unpacked ? triangleAt(page, unpacked.triangleIndex, viewProj, width, height) : null;
      triangles.set(id, triangle);
      return (dernier = triangle);
    },
    /** La description du matériau d'une page, calculée une fois par image et non par pixel. */
    material(page: VisPage) {
      let materiau = materiaux.get(page);
      if (!materiau) materiaux.set(page, (materiau = visMaterial(page.material)));
      return materiau;
    },
  };
}
export type VisibilityFrame = ReturnType<typeof createVisibilityFrame>;
