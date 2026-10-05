import type { WebgpuLightState } from './lights.ts';

/** The shadow contents' version: the virtual shadow map pages drawn, as their counts read back
 *  (`vsmSettle.ts`); another count is another shadow. */
export const shadowEpoch = (lights: WebgpuLightState) => lights.vsm?.settle.renderedTotal ?? 0;
