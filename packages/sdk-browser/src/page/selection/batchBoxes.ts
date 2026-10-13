import {
  BOX_VALUES,
  MATRIX_VALUES,
  boxTransform,
  boxUnionBatch,
} from '../../../../sdk-core/src/index.ts'
import { boxTransformLot, madeLot, type BoxTransformLot } from '../decode/batch/batchRuntime.ts'
import { mathBatchModule } from '../decode/batch/batchState.ts'
import type { ClusterRoot, PageRec } from './types.ts'

/**
 * World boxes computed IN BATCHES by the module's kernel, the one path: two utilities shared by
 * sites uniting bounds (`../../world/scene/pagesBounds.ts`, `../../host/world/bounds.ts`), and the
 * buffer of selection roots. A lot that no longer holds the boxes asked is remade at their count —
 * one allocation per growth —, never replaced by a loop of the single-element function. A run
 * covers the boxes written alone: a lot of every root moves the few that moved at their cost.
 *
 * ROOT BOXES REMAIN JAVASCRIPT ARRAYS: written during collection on each root, copied into the
 * buffer. Linear module memory is shared with the other kernels — the run-time cut's cones, the
 * animation sampler —, which allocate and may grow it mid-frame. The buffer survives —
 * `../../wasm/wasmArena.ts` rebuilds views on the same bytes and offsets.
 */

/** Root `root`'s world box, its local box at its world: what a single root taken or posed reads. */
export function refreshRootBox(
  root: Pick<ClusterRoot<PageRec>, 'world' | 'worldBox' | 'localBox'>,
) {
  if (root.worldBox && root.localBox)
    boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements)
}

/** The boxes a union of none writes into: nothing is ever written. */
const NO_BOXES = new Float64Array(0)

/**
 * Union of world bounds of any enumeration of `n` LOCAL boxes, in `lot` when it holds exactly
 * `n`, else in one made for the union and released as it closes.
 *
 * Sites uniting bounds — exact pages of mesh, subtree boxes — differ only in what they enumerate
 * and how 6 floats are written. Counting, `run()` and final union are identical logic written
 * once here.
 *
 * Caller writes local box into `boxes` at `at`, calls `pose(world)`. `close()` returns `into`.
 */
export function boxUnionCollector(
  into: Float64Array,
  lot: BoxTransformLot | null | undefined,
  n: number,
) {
  const own = n > 0 && !lot?.holds(n) ? madeLot(boxTransformLot(n), n) : null
  const used = own ?? (n > 0 ? lot : null)
  let i = 0
  return {
    /** The lot's buffer to write the next local box in. */
    get boxes() {
      return used ? used.boxes : NO_BOXES
    },
    /** Index where to write in `boxes`. */
    get at() {
      return i * BOX_VALUES
    },
    /** The box just written paired with its world matrix. */
    pose(world: ArrayLike<number>) {
      used?.mats.set(world, i++ * MATRIX_VALUES)
    },
    /** Runs the lot over the boxes written, then returns their union. */
    close() {
      if (used && i) {
        used.run(i)
        boxUnionBatch(into, used.out, i)
      }
      own?.release()
      return into
    },
  }
}

/** The boxes of the roots `ranks` lists, its first `count` — the first `count` roots without
 *  `ranks` —, moved to their worlds in ONE RUN of `lot`: each root that declares its boxes written
 *  at the next place, the run over those alone, each world box read back. */
function moveInLot(
  lot: BoxTransformLot,
  roots: readonly ClusterRoot<PageRec>[],
  count: number,
  ranks?: readonly number[],
) {
  const { boxes, mats } = lot
  let m = 0
  for (let k = 0; k < count; k++) {
    const root = roots[ranks ? ranks[k] : k]
    if (!root.localBox || !root.worldBox) continue
    boxes.set(root.localBox, m * BOX_VALUES)
    mats.set(root.world.elements, m++ * MATRIX_VALUES)
  }
  if (!m) return
  lot.run(m)
  const out = lot.out
  m = 0
  for (let k = 0; k < count; k++) {
    const root = roots[ranks ? ranks[k] : k],
      box = root.worldBox
    if (!root.localBox || !box) continue
    const at = m++ * BOX_VALUES
    for (let c = 0; c < BOX_VALUES; c++) box[c] = out[at + c]
  }
}

/** `lot` while it holds one box per root of `roots`; else one remade at their count, the old one
 *  released — `null` for no root. What the caller keeps as the roots' lot. */
export function rootBoxesFor(lot: BoxTransformLot | null, roots: readonly ClusterRoot<PageRec>[]) {
  if (lot && lot.n === roots.length && lot.holds(lot.n)) return lot
  lot?.release()
  return roots.length ? madeLot(boxTransformLot(roots.length), roots.length) : null
}

/**
 * The roots' lot, once the module has arrived, and its first run on every root: the world boxes
 * it reads back equal those collection computed. `null` for no root.
 */
export async function reserveRootBoxes(roots: readonly ClusterRoot<PageRec>[]) {
  await mathBatchModule()
  const lot = rootBoxesFor(null, roots)
  if (lot) moveInLot(lot, roots, roots.length)
  return lot
}

/**
 * The world boxes of the roots whose ranks `moved` lists, its first `count`, moved in one run of
 * the roots' lot (`rootBoxesFor`: `lot`, or the one remade when it no longer holds them). Returns
 * the lot the caller keeps.
 */
export function transformRootBoxes(
  lot: BoxTransformLot | null,
  roots: readonly ClusterRoot<PageRec>[],
  moved: readonly number[],
  count: number,
) {
  const held = rootBoxesFor(lot, roots)
  if (held) moveInLot(held, roots, count, moved)
  return held
}
