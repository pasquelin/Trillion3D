import { tradeCamera, tradeView as trade } from '../../../frame/viewTrade.ts';
import { releaseTargets } from '../prepare/targets.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { VIEW_GPU_KEYS, VIEW_RUN_KEYS, VIEW_VIS_KEYS, type WebgpuView } from './view.ts';

/**
 * The one place a view is switched: every reader goes through the runtime groups, and they hold
 * `view`'s state once this returns. References are traded, nothing is allocated. The gate learns
 * the view was replaced (no view holds on another's image), the held host lists age with the cut
 * they described. The shared Hi-Z pyramid follows at the view's next frame, under the device's
 * out-of-memory check (`../prepare/targetGrant.ts`).
 */
export function useWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const { views, run, gpu, vis, setup } = rt,
    from = views.active;
  if (from === view) return;
  trade(run, from.run, view.run, VIEW_RUN_KEYS);
  trade(gpu, from.gpu, view.gpu, VIEW_GPU_KEYS);
  trade(vis, from.vis, view.vis, VIEW_VIS_KEYS);
  // The arrays are traded, never copied: the host's, which its resizes write, stays the main
  // view's, and a resize during a capture is not undone when the main view comes back.
  from.viewport = setup.viewport;
  setup.viewport = view.viewport;
  views.active = view;
  tradeCamera(run.gate, from, view);
  run.cutEpoch++;
}

/** Releases the targets of `view`, which is not the main one, and takes its cut out of what the
 *  residency holds; the main view is drawn again. */
export function releaseWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  useWebgpuView(rt, view);
  releaseTargets(rt);
  useWebgpuView(rt, rt.views.main);
  rt.services.releaseView(view);
}
