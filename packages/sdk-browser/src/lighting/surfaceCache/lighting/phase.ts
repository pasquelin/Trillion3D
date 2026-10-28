import { noiseFrame } from '../../../frame/render/noiseFrame.ts'

/**
 * The phase the lighting's noise turns on (shadows, occlusion, probes, subsurface, the translucency volume): the one clock of the image, `noiseFrame` — counted from the later of the
 * surface cache's light start and the view's last change or final image — whatever temporal state the view keeps. The shading's own noise reads the same clock, so that every pass of an
 * image draws the same noise, and two worlds of one scene meet the same phases at the image they hold.
 */
export const lightingPhase = noiseFrame
