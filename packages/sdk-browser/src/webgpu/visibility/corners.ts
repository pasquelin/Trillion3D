import { CORNER_VALUES, writeSplitDouble } from '../../gpu/partition/contract.ts';
import { forEachRewrittenRun } from '../row/dirty.ts';
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
 * moment: a moving camera rewrites none. On an ordinary image, only the rows the table just declared
 * dirty travel, run by run — a model whose rows are scattered sends its own and none of the rows
 * between them — and a new age asks for the drawable rows again, once.
 *
 * The corners are those double precision computes (`createBoxCorners`), each carried by TWO single-
 * precision values: the rounded value and its residue. The kernel reports them to the camera pose,
 * itself in two words, so world magnitude survives no subtraction and its error bound depends only
 * on cluster size (`../../gpu/partition/margins.ts`).
 */
export function uploadRowCorners(rt: WebgpuPagesRuntime) {
  const { rows, cornerHold } = rt.layout,
    partition = rt.vis.gpuPartition;
  if (!partition) return;
  const stale = cornerHold.epoch !== rows.tableEpoch;
  if (stale) cornerHold.epoch = rows.tableEpoch;
  // Rows whose page arrived, left, changed rank or moved: what they held describes another page or
  // another place, and the partition reads them as never projected. A new age moves no page between
  // ranks, so the rows it re-uploads beyond those runs keep their history, on corners that moved.
  if (stale) {
    forEachRewrittenRun(rows, cornerHold.count, partition, forgetRun);
    if (rows.packedCount > 0) uploadRun(rt, 0, rows.packedCount - 1);
  } else forEachRewrittenRun(rows, cornerHold.count, rt, forgetAndUploadRun);
  cornerHold.count = rows.packedCount;
}

function forgetRun(partition: GpuPartition, from: number, to: number) {
  partition.forgetRows(from, to);
}

function forgetAndUploadRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  rt.vis.gpuPartition!.forgetRows(from, to);
  uploadRun(rt, from, to);
}

/** Packs the corners of rows `[from, to]` and sends them in one write. */
function uploadRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  const { rows, boxCorners, cornerPacked } = rt.layout;
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
  rt.vis.gpuPartition!.uploadCorners(cornerPacked, from, to);
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
