import { DISPLAY_FORMAT, FEEDBACK_FORMAT, SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts'

/** The five targets of the surface stage: the three material surfaces, the water word in the
 *  display colour it borrows, then the virtual-texture feedback. */
const SURFACE_TARGETS: GPUColorTargetState[] = [
  ...SURFACE_FORMATS.slice(0, 3).map((format) => ({ format })),
  { format: DISPLAY_FORMAT },
  { format: FEEDBACK_FORMAT },
]
export const waterSurfaceTargets = (feedback: boolean) =>
  feedback ? SURFACE_TARGETS : SURFACE_TARGETS.slice(0, 4)
