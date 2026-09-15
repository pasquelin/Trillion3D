import type { ShadowViewpoint } from './sceneLightSunCascades.ts';

/**
 * Ce qui périme une carte d'ombre : la boîte de ce qui a bougé dans le monde depuis que les ombres
 * l'ont rattrapé, et la révision de la vue — une cascade du soleil suit la caméra, donc une caméra
 * qui bouge la périme, alors qu'une lampe ponctuelle s'en moque. Tout est alloué une fois.
 */
export function createShadowChanges() {
  const moved = { min: [0, 0, 0], max: [0, 0, 0], valid: false };
  const lastView = new Float64Array(9),
    seen = new Float64Array(9);
  let worldEpoch = 1,
    viewEpoch = 1;
  /** Écart d'une coordonnée à l'intervalle de la boîte déplacée, nul à l'intérieur. */
  const outside = (value: number, axis: number) =>
    Math.max(moved.min[axis] - value, value - moved.max[axis], 0);
  return {
    get worldEpoch() {
      return worldEpoch;
    },
    get viewEpoch() {
      return viewEpoch;
    },
    /** Vrai tant qu'un mouvement du monde n'a pas encore été rattrapé par toutes les cartes. */
    get worldMoved() {
      return moved.valid;
    },
    /** Un nœud a bougé : la boîte s'unit à celle des mouvements que les ombres n'ont pas rattrapés. */
    worldChanged(min: readonly number[], max: readonly number[]) {
      for (let axis = 0; axis < 3; axis++) {
        moved.min[axis] = moved.valid ? Math.min(moved.min[axis], min[axis]) : min[axis];
        moved.max[axis] = moved.valid ? Math.max(moved.max[axis], max[axis]) : max[axis];
      }
      moved.valid = true;
      worldEpoch++;
    },
    /** Monte la révision de la vue dès qu'un de ses neuf nombres a changé, jamais autrement. */
    noteView(view: ShadowViewpoint) {
      seen.set([...view.position, ...view.forward, view.halfFovY, view.aspect, view.far]);
      for (let i = 0; i < seen.length; i++)
        if (seen[i] !== lastView[i]) {
          lastView.set(seen);
          viewEpoch++;
          return;
        }
    },
    /** Sphère d'influence de la lampe contre la boîte déplacée : un test analytique, pas un rayon. */
    touchesMoved(x: number, y: number, z: number, range: number) {
      if (!moved.valid) return false;
      const dx = outside(x, 0),
        dy = outside(y, 1),
        dz = outside(z, 2);
      return dx * dx + dy * dy + dz * dz <= range * range;
    },
    settled() {
      moved.valid = false;
    },
  };
}
