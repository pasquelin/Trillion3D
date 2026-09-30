import type { WebgpuLightState } from './lights.ts';

/** The shadow contents' version: the pages the host drew, and those the GPU listed to draw itself
 *  (`listDraw`, known a snapshot late); a change of either is another shadow. */
export const shadowEpoch = (lights: WebgpuLightState) =>
  lights.shadowPagesTotal + lights.plan.gpu.drawn;
