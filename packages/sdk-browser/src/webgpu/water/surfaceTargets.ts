import { REQUEST_OUTPUT, SURFACE_OUTPUTS } from '../../scene/surfaceOutputs.ts'
import { DISPLAY_FORMAT } from '../../scene/targetFormats.ts'
import { PHYSICAL_LOBES_FORMAT } from '../../scene/physicalLobes.ts'
import { fragmentTargets, type FragmentOutput } from '../../gpu/core/fragmentOutputs.ts'

/** The surface stage's outputs in their locations' order (`surfaceWgsl.ts`): the three material
 *  surfaces, the water word in the display colour it borrows, the lobes target where the stage is
 *  lobed, then the virtual-texture feedback where it is written. */
const WATER_SURFACE_OUTPUTS: readonly (FragmentOutput & { when?: 'lobes' | 'feedback' })[] = [
  ...SURFACE_OUTPUTS.slice(0, 3),
  { name: 'word', wgsl: 'vec4f', format: DISPLAY_FORMAT },
  { name: 'lobes', wgsl: 'vec4u', format: PHYSICAL_LOBES_FORMAT, when: 'lobes' },
  { ...REQUEST_OUTPUT, when: 'feedback' },
]

/** The outputs of the surface stage writing the feedback or not, with the lobes or not, in order:
 *  its targets and its WGSL output struct (always with the request, last) are read from them. */
export const waterSurfaceOutputs = (feedback: boolean, lobes = false) =>
  WATER_SURFACE_OUTPUTS.filter(({ when }) => !when || (when === 'lobes' ? lobes : feedback))

/** The targets of the surface stage (`waterSurfaceOutputs`). */
export const waterSurfaceTargets = (feedback: boolean, lobes = false) =>
  fragmentTargets(waterSurfaceOutputs(feedback, lobes))

/** The surface stage's entry, with the lobes or not; the feedback is its pipeline's `FEEDBACK`
 *  (`feedbackConstants`), its request's target left out without it. */
export const waterSurfaceEntry = (lobes = false) => `fsWater${lobes ? 'Lobed' : ''}`
