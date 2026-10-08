import { DISPLAY_FORMAT, FEEDBACK_FORMAT, SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts'
import { PHYSICAL_LOBES_FORMAT } from '../../scene/physicalLobes.ts'

/** The targets of the surface stage: the three material surfaces, the water word in the display
 *  colour it borrows, with `lobes` the lobes target (`surfaceWgsl.ts`), then the virtual-texture
 *  feedback. */
export const waterSurfaceTargets = (feedback: boolean, lobes = false): GPUColorTargetState[] => [
  ...SURFACE_FORMATS.slice(0, 3).map((format) => ({ format })),
  { format: DISPLAY_FORMAT },
  ...(lobes ? [{ format: PHYSICAL_LOBES_FORMAT }] : []),
  ...(feedback ? [{ format: FEEDBACK_FORMAT }] : []),
]

/** The surface stage's entry: with the lobes or not, writing the feedback or not (`waterPass.ts`). */
export const waterSurfaceEntry = (feedback: boolean, lobes = false) =>
  `fsWater${lobes ? 'Lobed' : ''}${feedback ? '' : 'WithoutFeedback'}`
