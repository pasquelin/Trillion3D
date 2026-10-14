import { SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts'
import { FEEDBACK_FORMAT } from '../../scene/targetFormats.ts'

export const shadeTargetFormats = (feedback: boolean) => [
  ...SURFACE_FORMATS,
  ...(feedback ? [FEEDBACK_FORMAT] : []),
]
