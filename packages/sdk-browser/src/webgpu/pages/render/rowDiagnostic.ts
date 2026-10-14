import { ROW_WORDS } from '../../../visibility/types.ts'
import { PAGE_INFO, levelDiagnostic } from '../../../visibility/pageInfo.ts'
import { projectedPageError } from '../../../page/selection/diagnostic.ts'
import { rootOf, rootOfPacked } from '../../../page/selection/placements.ts'
import { screenErrorRatio } from '../../../diagnostic/colors.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'

/**
 * THE ROWS' DIAGNOSTIC WORD as the drawn view reads it (`PAGE_INFO.at.diagnosticWord`, in the row's own
 * words): each packed row's screen-error ratio while the screen-error view is drawn — taken again
 * every image, it follows the camera —, and its level (`levelDiagnostic`) again the first image
 * after. Each row written is marked for the upload; nothing on any other image.
 */
export function writeRowDiagnostics(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { run, layout } = rt,
    { rows } = layout,
    floats = rows.pageTableFloats
  const errorView = run.diagnostic === 'screen-error'
  if (!floats || (!errorView && !run.diagnosticErrorShown)) return
  run.diagnosticErrorShown = errorView
  for (let row = 0; row < rows.packedCount; row++) {
    const rec = rows.packedRecs[row]
    if (!rec) continue
    const at = row * ROW_WORDS + PAGE_INFO.at.diagnosticWord
    if (!errorView) floats[at] = levelDiagnostic(rec)
    else {
      const rank = rootOfPacked(layout.placement, rows.packedPageIndex[row])
      const error = projectedPageError(
        rec,
        rootOf(layout.selectionRoots, rank).world,
        cam,
        rt.setup.viewport,
      )
      floats[at] = screenErrorRatio(error, run.diagnosticPixelError)
    }
    rows.markRowWords(row)
  }
}
