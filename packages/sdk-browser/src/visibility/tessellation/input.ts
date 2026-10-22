import type { DisplacementRecords } from '../../materials/table/displacementRecord.ts'
import type { TessellationSettings, TessellationView } from './uniform.ts'

/** What a frame that draws displaced surfaces gives the raster's input: the surfaces' records, the
 *  view's numbers and the settings (`wanted.ts`). Absent, the frame tessellates nothing. */
export type TessellationInput = {
  displaced: Pick<DisplacementRecords, 'ints' | 'version'>
  view: TessellationView
  settings: TessellationSettings
}
