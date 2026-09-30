import { FEEDBACK_FORMAT, SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts';

export const shadeTargetFormats = (feedback: boolean) => [
  ...SURFACE_FORMATS,
  ...(feedback ? [FEEDBACK_FORMAT] : []),
];
