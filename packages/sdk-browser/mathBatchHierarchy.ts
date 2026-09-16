import {
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  hierarchyUpdateBatch,
} from '../sdk-core/index.ts';
import { f64, joue, taille, tampon, u32, vuesF64, type MathLot } from './mathBatchLot.ts';

/**
 * Le lot de la HIÉRARCHIE : `n` nœuds rangés parents avant enfants, dont les matrices monde sont
 * recalculées en une passe — matrice locale composée depuis la pose, puis multipliée par la matrice
 * monde du parent. C'est le travail de `mathTransformTreeUpdate.ts` sur une hiérarchie entière, le
 * cas du chargement et celui d'une scène qui bouge en bloc, où le coût est proportionnel aux nœuds.
 *
 * Les cinq tampons vivent dans l'arène : le noyau WebAssembly les lit et les écrit sur place, sans
 * qu'un seul nombre traverse la frontière. `parents[i]` doit désigner un nœud d'indice strictement
 * inférieur à `i` ; `HIERARCHY_ROOT` — et toute autre valeur — fait du nœud une racine, des deux
 * côtés à la même règle.
 */

/** Le nom sous lequel le gouverneur tient ses médianes, et la clé du relevé publié. */
const HIERARCHY_UPDATE_BATCH = 'hierarchyUpdateBatch';

export interface HierarchyLot extends MathLot {
  /** `3 · n` nombres : les positions locales. */
  readonly positions: Float64Array;
  /** `4 · n` nombres : les quaternions locaux, rangés `(x, y, z, w)`. */
  readonly rotations: Float64Array;
  /** `3 · n` nombres : les échelles locales. */
  readonly scales: Float64Array;
  /** `n` entiers : l'indice du parent, `HIERARCHY_ROOT` pour une racine. */
  readonly parents: Uint32Array;
  /** `16 · n` nombres : les matrices monde, colonne-major. */
  readonly world: Float64Array;
}

/** La matrice locale du nœud courant, relue aussitôt : le lot n'alloue rien pendant qu'il tourne. */
const local = new Float64Array(MATRIX_VALUES);

/** Un lot de `n` nœuds de hiérarchie, parents avant enfants. */
export async function createHierarchyLot(n: number): Promise<HierarchyLot> {
  const { wasm, blocs, release } = await tampon([
    { type: 'f64', longueur: n * MATRIX_VALUES, pas: MATRIX_VALUES },
    { type: 'f64', longueur: n * POSITION_VALUES, pas: POSITION_VALUES },
    { type: 'f64', longueur: n * QUATERNION_VALUES, pas: QUATERNION_VALUES },
    { type: 'f64', longueur: n * POSITION_VALUES, pas: POSITION_VALUES },
    { type: 'u32', longueur: n },
  ]);
  const [monde, positions, rotations, echelles, parents] = blocs().map((bloc) => bloc.offset);
  const wasmRun = wasm
    ? () => wasm.math_hierarchy_update_batch(monde, positions, rotations, echelles, parents, n)
    : null;
  return {
    n,
    shared: wasm !== null,
    get world() {
      return f64(blocs()[0]);
    },
    get positions() {
      return f64(blocs()[1]);
    },
    get rotations() {
      return f64(blocs()[2]);
    },
    get scales() {
      return f64(blocs()[3]);
    },
    get parents() {
      return u32(blocs()[4]);
    },
    holds: (count) => count > 0 && taille(blocs(), 0) === count * MATRIX_VALUES,
    run: () => {
      const b = blocs();
      return joue(HIERARCHY_UPDATE_BATCH, n, wasmRun, () =>
        hierarchyUpdateBatch(
          vuesF64(b[0]),
          vuesF64(b[1]),
          vuesF64(b[2]),
          vuesF64(b[3]),
          u32(b[4]),
          n,
          local,
        ),
      );
    },
    release,
  };
}
