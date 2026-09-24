import {
  BOX_VALUES,
  MATRIX_VALUES,
  boxTransform,
  boxUnionBatch,
} from '../../../sdk-core/src/index.ts';
import { createBoxTransformLot, type BoxTransformLot } from './batchRuntime.ts';
import type { ClusterRoot, PageRec } from '../page/selection/types.ts';

/**
 * World boxes computed IN BATCHES: two utilities shared by sites uniting bounds
 * (`../world/scene/pagesBounds.ts`, `../host/world/bounds.ts`), and the buffer of selection roots.
 *
 * World boxes of selection roots, computed IN BATCHES by governor: single buffer
 * allocated during setup, zero allocation afterward. Loading runs it once on all roots;
 * node transformation (R8) updates matrices of affected roots and re-runs. Unchanged roots
 * pass through kernel with same inputs as reservation: their output is ignored.
 *
 * ROOT BOXES REMAIN JAVASCRIPT ARRAYS: written during collection on each root, copied
 * into buffer. Linear module memory belongs to page decoder: main thread decoding
 * (`../page/decode/host.ts`) allocates and may grow mid-frame. Buffer survives — `../page/decode/wasmArena.ts`
 * rebuilds views on same bytes/offsets —, and `holds()` falls back to JS only when buffer
 * released or root count changed.
 */

/** Batch when holding exactly `n` boxes, `null` otherwise: caller falls back box by box. */
function lotBoxesReady(lot: BoxTransformLot | null | undefined, n: number) {
  return lot?.holds(n) ? lot : null;
}

/** Union into `into` of first `n` boxes produced by batch. */
function unionLotBoxes(into: Float64Array, lot: BoxTransformLot, n: number) {
  boxUnionBatch(into, lot.out, n);
}

/**
 * Union of world bounds of any enumeration of LOCAL boxes.
 *
 * Sites uniting bounds — exact pages of mesh, subtree boxes — differ only in what they enumerate
 * and how 6 floats are written. Batch/single toggle, counting, `run()` and final union are
 * identical logic written once here.
 *
 * Caller writes local box into `boxes` at `at`, calls `pose(world)`. `ferme()` returns `into`.
 */
export function boxUnionCollector(
  into: Float64Array,
  lot: BoxTransformLot | null | undefined,
  n: number,
) {
  const enLot = lotBoxesReady(lot, n);
  const seule = new Float64Array(BOX_VALUES);
  let i = 0;
  return {
    /** Buffer to write local box: batch buffer, or single pass-through box. */
    get boxes() {
      return enLot ? enLot.boxes : seule;
    },
    /** Index where to write in `boxes`. */
    get at() {
      return enLot ? i * BOX_VALUES : 0;
    },
    /** Box just written paired with world matrix: in batch or single. */
    pose(world: ArrayLike<number>) {
      if (enLot) {
        enLot.mats.set(world, i++ * MATRIX_VALUES);
        return;
      }
      boxTransform(seule, 0, seule, 0, world);
      boxUnionBatch(into, seule, 1);
    },
    /** Runs batch if available, then returns union. */
    ferme() {
      if (enLot) {
        enLot.run();
        unionLotBoxes(into, enLot, i);
      }
      return into;
    },
  };
}

/** Local box and world matrix of root `i` written to batch. */
function ecrit(lot: BoxTransformLot, i: number, root: ClusterRoot<PageRec>) {
  lot.boxes.set(root.localBox!, i * BOX_VALUES);
  lot.mats.set(root.world.elements, i * MATRIX_VALUES);
}

/** World box of root `i` re-read from batch. */
function relit(lot: BoxTransformLot, i: number, root: ClusterRoot<PageRec>) {
  const out = lot.out,
    box = root.worldBox!,
    at = i * BOX_VALUES;
  for (let k = 0; k < BOX_VALUES; k++) box[k] = out[at + k];
}

/**
 * Reserves root batch and runs first pass: world boxes returned equal those computed by collection.
 * `null` when nothing to compute or root misses box declarations — caller remains on JS path.
 */
export async function reserveRootBoxes(roots: readonly ClusterRoot<PageRec>[]) {
  if (!roots.length || roots.some((root) => !root.localBox || !root.worldBox)) return null;
  const lot = await createBoxTransformLot(roots.length);
  if (!lotBoxesReady(lot, roots.length)) return null;
  for (let i = 0; i < roots.length; i++) ecrit(lot, i, roots[i]);
  lot.run();
  for (let i = 0; i < roots.length; i++) relit(lot, i, roots[i]);
  return lot;
}

/** Roots retained by last replay: predicate traverses hierarchy. */
let moved = new Uint8Array(0);

/**
 * Replays batch for roots retained by `deplacee`. Returns `false` when buffer unplayable
 * (released or size changed): caller falls back box by box with identical result.
 */
export function transformRootBoxes(
  lot: BoxTransformLot,
  roots: readonly ClusterRoot<PageRec>[],
  deplacee: (root: ClusterRoot<PageRec>) => boolean,
) {
  if (roots.length !== lot.n || !lot.holds(lot.n)) return false;
  if (moved.length < roots.length) moved = new Uint8Array(roots.length);
  for (let i = 0; i < roots.length; i++) {
    moved[i] = deplacee(roots[i]) ? 1 : 0;
    if (moved[i]) ecrit(lot, i, roots[i]);
  }
  lot.run();
  for (let i = 0; i < roots.length; i++) if (moved[i]) relit(lot, i, roots[i]);
  return true;
}
