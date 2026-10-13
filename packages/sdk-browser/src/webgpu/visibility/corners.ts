import { writeSplitDouble } from '../../../../math/src/float/splitDouble.ts'
import { forEachRewrittenRun } from '../row/dirty.ts'
import { BOX_CORNER_VALUES, pageCornersInto } from '../../hiz/corners.ts'
import type { HizPage } from '../../hiz/types.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { MatrixElements } from '../../host/matrixElements.ts'

/** What describes the rows the partition holds a history for: the drawable rank it last read. */
export function createCornerHold() {
  return { count: 0 }
}

/**
 * The rows whose occlusion history the partition forgets: those whose page arrived, left or changed
 * rank — what their verdict described is another page — and the rows the drawable rank grew by,
 * run by run (`forEachRewrittenRun`). Their eight world corners are the rows pass's
 * (`../../placement/rowWordsPass.ts`), which writes them from each row's root's world, the doubles
 * `pageCornersInto` derives, each carried by TWO single-precision values: the rounded value and its
 * residue. The kernel reports them to the camera pose, itself in two words, so world magnitude
 * survives no subtraction and its error bound depends only on cluster size
 * (`../../gpu/partition/margins.ts`). A row that only moved keeps its history: a stale rectangle
 * only moves a row between the two halves, never a pixel (`../../gpu/partition/projectWgsl.ts`).
 */
export function forgetRewrittenRows(rt: WebgpuPagesRuntime) {
  const { rows, cornerHold } = rt.layout
  // No partition reads the marks this image clears: the hold goes back to holding nothing, and the
  // partition that reads next forgets every drawable row's history.
  if (!rt.vis.gpuPartition) {
    cornerHold.count = 0
    return
  }
  forEachRewrittenRun(rows, cornerHold.count, rt, forgetRun)
  cornerHold.count = rows.packedCount
}

function forgetRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  rt.vis.gpuPartition!.forgetRows(from, to)
}

const pageCorners = new Float64Array(BOX_CORNER_VALUES)

/**
 * The eight world corners of `page` placed by `world` and grown by `reach`, derived by `pageCornersInto`, written in `packed` from `base`.
 * Each coordinate leaves in two words: the single-precision rounding, then what it left. The sum of
 * the two represents the original double to within a squared ulp.
 */
export function packPageCorners(
  packed: Float32Array,
  base: number,
  page: HizPage,
  world: MatrixElements,
  reach = 0,
) {
  pageCornersInto(pageCorners, 0, page, world, reach)
  for (let k = 0; k < 8; k++)
    for (let axis = 0; axis < 3; axis++)
      writeSplitDouble(
        packed,
        base + k * 6 + axis,
        base + k * 6 + 3 + axis,
        pageCorners[k * 3 + axis],
      )
}
