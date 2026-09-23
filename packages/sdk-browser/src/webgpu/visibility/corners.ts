import { CORNER_VALUES, writeSplitDouble } from '../../gpu/partition/contract.ts';
import { dirtyRange } from '../row/state.ts';
import type { GpuPartition } from '../../gpu/partition/types.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** What describes the corners already sent to the GPU: the age of the table they came from. */
export function createCornerUploadHold() {
  return { epoch: -1, count: 0 };
}

/**
 * The eight world corners of every drawable row, in the buffer GPU projection reads.
 *
 * A corner changes only when its page's world matrix changes, and the table's age names exactly that
 * moment: a moving camera rewrites none. On an ordinary image, only the range the table just declared
 * dirty travels — the same interval shadow spheres borrow — and a new age asks for the drawable rows
 * again, once.
 *
 * The corners are those double precision computes (`createBoxCorners`), each carried by TWO single-
 * precision values: the rounded value and its residue. The kernel reports them to the camera pose,
 * itself in two words, so world magnitude survives no subtraction and its error bound depends only
 * on cluster size (`../../gpu/partition/margins.ts`).
 */
export function uploadRowCorners(rt: WebgpuPagesRuntime, partition: GpuPartition) {
  const { rows, boxCorners, cornerPacked, cornerHold } = rt.layout;
  const stale = cornerHold.epoch !== rows.tableEpoch;
  if (stale) cornerHold.epoch = rows.tableEpoch;
  // Rows whose page arrived, left or changed rank: what they held describes another page, and
  // the partition reads them as never projected. A new age moves no page between ranks, so the
  // rows it re-uploads beyond that interval keep their history, on corners that moved.
  const rewritten = dirtyRange(rows, false, cornerHold.count);
  partition.forgetRows(rewritten.from, rewritten.to);
  const { from, to } = dirtyRange(rows, stale, cornerHold.count);
  cornerHold.count = rows.packedCount;
  if (to < from) return;
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row];
    const base = row * CORNER_VALUES;
    if (!rec) {
      cornerPacked.fill(0, base, base + CORNER_VALUES);
      continue;
    }
    packBoxCorners(
      cornerPacked,
      base,
      boxCorners.corners,
      boxCorners.at(rows.packedPageIndex[row], rec, rows.tableEpoch),
    );
  }
  partition.uploadCorners(cornerPacked, from, to);
}

/**
 * The eight corners of a box, read in `corners` from `at`, written in `packed` from `base`. Each
 * coordinate leaves in two words: the single-precision rounding, then what it left. The sum of the
 * two represents the original double to within a squared ulp.
 */
export function packBoxCorners(
  packed: Float32Array,
  base: number,
  corners: ArrayLike<number>,
  at: number,
) {
  for (let k = 0; k < 8; k++)
    for (let axis = 0; axis < 3; axis++)
      writeSplitDouble(
        packed,
        base + k * 6 + axis,
        base + k * 6 + 3 + axis,
        corners[at + k * 3 + axis],
      );
}
