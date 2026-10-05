import { shadowEpoch } from '../webgpu/pages/state/shadowEpoch.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { TaaFrameState } from './frameState.ts';

/** The still average restarts, history dropped, whichever view holds it: the one place that does,
 *  for every cause — a view cut, a landing, a settled reflection, a new size or scale, a barrier's
 *  landing. A moving image only zeroes the count (`beginTaaFrame`); it keeps its history. */
export function restartTaaAverage(frame: TaaFrameState | undefined) {
  if (!frame) return;
  frame.hasHistory = false;
  frame.stillFrames = 0;
}

/** A tile or a shadow page that lands on a still image changes the raster in the middle of its
 *  average: the uniform average restarts on it, from phase zero at the next image, as a barrier's
 *  landing does (`mustRestartTaaAfterSettle`, #1016). */
export function restartTaaOnLanding(rt: WebgpuPagesRuntime, landed: number) {
  const temporal = rt.gpu.temporal;
  if (landed > 0 && temporal?.frame.active && temporal.frame.stillFrames > 0)
    restartTaaAverage(temporal.frame);
}

/** A shadow landed since the still average last looked: the virtual shadow maps drew pages, known
 *  a few frames late (`shadowEpoch`) — else a shadow drawn at rest stays diluted in the still
 *  average, faint (#1344). */
export function restartTaaOnShadowLanding(rt: WebgpuPagesRuntime) {
  const frame = rt.gpu.temporal?.frame;
  if (!frame) return;
  const epoch = shadowEpoch(rt.lights);
  restartTaaOnLanding(rt, epoch === frame.shadowsSeen ? 0 : 1);
  frame.shadowsSeen = epoch;
}
