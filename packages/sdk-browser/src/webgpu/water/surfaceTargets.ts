import { SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts'
import { DISPLAY_FORMAT, FEEDBACK_FORMAT } from '../../scene/targetFormats.ts'
import { PHYSICAL_LOBES_FORMAT } from '../../scene/physicalLobes.ts'
import { fragmentTargets, type FragmentOutput } from '../../gpu/core/fragmentOutputs.ts'

/** The surface stage's outputs in their locations' order (`surfaceWgsl.ts`): the three material
 *  surfaces, the water word in the display colour it borrows, the lobes target where the stage is
 *  lobed, then the virtual-texture feedback where it is written. */
const WATER_SURFACE_OUTPUTS: readonly (FragmentOutput & { when?: 'lobes' | 'feedback' })[] = [
  { name: 'baseMetal', wgsl: 'vec4f', format: SURFACE_FORMATS[0] },
  { name: 'normalRough', wgsl: 'vec4f', format: SURFACE_FORMATS[1] },
  { name: 'emissiveAo', wgsl: 'vec4f', format: SURFACE_FORMATS[2] },
  { name: 'word', wgsl: 'vec4f', format: DISPLAY_FORMAT },
  { name: 'lobes', wgsl: 'vec4u', format: PHYSICAL_LOBES_FORMAT, when: 'lobes' },
  { name: 'request', wgsl: 'u32', format: FEEDBACK_FORMAT, when: 'feedback' },
]

/** The outputs of the surface stage writing the feedback or not, with the lobes or not, in order:
 *  its targets, its WGSL output struct and its feedback-free entry's are read from them. */
export const waterSurfaceOutputs = (feedback: boolean, lobes = false) =>
  WATER_SURFACE_OUTPUTS.filter(({ when }) => !when || (when === 'lobes' ? lobes : feedback))

/** The targets of the surface stage (`waterSurfaceOutputs`). */
export const waterSurfaceTargets = (feedback: boolean, lobes = false) =>
  fragmentTargets(waterSurfaceOutputs(feedback, lobes))

/** The surface stage's entry: with the lobes or not, writing the feedback or not (`waterPass.ts`). */
export const waterSurfaceEntry = (feedback: boolean, lobes = false) =>
  `fsWater${lobes ? 'Lobed' : ''}${feedback ? '' : 'WithoutFeedback'}`
