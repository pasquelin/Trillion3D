import { forEachRewrittenRun } from '../row/dirty.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

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
