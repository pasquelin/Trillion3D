import type { PageRec } from './pageSelection.ts';
import type { CutDelta } from './webgpuCutDelta.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';
import { noteResidenceChange } from './webgpuShadowBounds.ts';

/** Resident geometry can enter or leave the drawn cut without a residency event. Invalidate
 * both sets of world bounds: removed casters must disappear and new casters must appear. */
export function noteShadowCutChange(
  lights: WebgpuLightState,
  pages: readonly PageRec[],
  delta: CutDelta,
) {
  if (!lights.store.count || !(delta.enteredCount + delta.exitedCount)) return false;
  for (let i = 0; i < delta.exitedCount; i++) noteResidenceChange(lights, pages[delta.exited[i]]);
  for (let i = 0; i < delta.enteredCount; i++) noteResidenceChange(lights, pages[delta.entered[i]]);
  return true;
}
