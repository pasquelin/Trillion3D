import type { DisplacementRecords } from '../../materials/table/displacementRecord.ts'
import type { CutPyramid } from '../../geometry/dag/occlusion.ts'
import type { SelectionUniforms } from '../../gpu/core/selection.ts'
import type { TessellationSettings, TessellationView } from './uniform.ts'

/** What a frame that draws displaced surfaces gives the raster's input: the surfaces' records, the
 *  view's numbers and the settings (`wanted.ts`). Absent, the frame tessellates nothing. */
export type TessellationInput = {
  displaced: Pick<DisplacementRecords, 'ints' | 'version'>
  view: TessellationView
  settings: TessellationSettings
  occlusion: TessellationOcclusion
}

/** What the patches' occlusion test reads: the pyramid of the previous image the main pass tests
 *  against — none for a cut in one pass, which tests no patch —, the pyramid of this image's main
 *  pass, which the post pass tests against and exists once it began, and the view's matrices and
 *  depth maps (`SelectionUniforms`). */
export type TessellationOcclusion = {
  previous: CutPyramid | undefined
  current(): CutPyramid | undefined
  uniforms: Pick<SelectionUniforms, 'prevViewProj' | 'depthMap' | 'prevDepthMap' | 'prevSize'>
}
