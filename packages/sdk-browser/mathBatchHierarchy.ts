import {
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  hierarchyUpdateBatch,
} from '../sdk-core/src/index.ts';
import { f64, joue, taille, tampon, u32, vuesF64, type MathLot } from './mathBatchLot.ts';

/**
 * HIERARCHY batch: `n` nodes ordered parent before children, whose world matrices are
 * recomputed in a single pass — local matrix composed from pose, then multiplied by parent's
 * world matrix. This is the work of `mathTransformTreeUpdate.ts` across an entire hierarchy,
 * during loading and for scene moving as a block, where cost is proportional to node count.
 *
 * The five buffers live in the arena: WebAssembly kernel reads and writes them in place, without
 * a single number crossing the boundary. `parents[i]` must designate a node index strictly
 * smaller than `i`; `HIERARCHY_ROOT` — and any other value — turns node into root by same rule.
 */

/** Name under which governor holds medians, and key of published report. */
const HIERARCHY_UPDATE_BATCH = 'hierarchyUpdateBatch';

export interface HierarchyLot extends MathLot {
  /** `3 · n` numbers: local positions. */
  readonly positions: Float64Array;
  /** `4 · n` numbers: local quaternions, ordered `(x, y, z, w)`. */
  readonly rotations: Float64Array;
  /** `3 · n` numbers: local scales. */
  readonly scales: Float64Array;
  /** `n` integers: parent index, `HIERARCHY_ROOT` for root. */
  readonly parents: Uint32Array;
  /** `16 · n` numbers: world matrices, column-major. */
  readonly world: Float64Array;
}

/** Current node local matrix, re-read immediately: batch allocates nothing during run. */
const local = new Float64Array(MATRIX_VALUES);

/** A batch of `n` hierarchy nodes, parent before children. */
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
