import { BOX_VALUES, MATRIX_VALUES, boxUnionBatch } from '../../../../sdk-core/src/index.ts'
import { boxTransformLot, madeLot, type BoxTransformLot } from '../decode/batch/batchRuntime.ts'

/**
 * World boxes computed IN BATCHES by the module's kernel: the union of the bounds of many local
 * boxes, each at its world, for the sites that unite them (`../../world/scene/pagesBounds.ts`,
 * `../../host/world/bounds.ts`). A lot that does not hold the boxes asked is made at their count
 * for the union, never replaced by a loop of the single-element function. A root's own world box
 * is taken when read (`rootWorld.ts`), never in a batch.
 */

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
