import { releaseTargets } from '../prepare/targets.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { VIEW_GPU_KEYS, VIEW_RUN_KEYS, VIEW_VIS_KEYS, type WebgpuView } from './view.ts';

/** Moves `keys` of the live group into `from`'s record, then `to`'s into the live group. */
function trade<T, K extends keyof T>(
  live: T,
  from: Pick<T, K>,
  to: Pick<T, K>,
  keys: readonly K[],
) {
  for (const key of keys) {
    from[key] = live[key];
    live[key] = to[key];
  }
}

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
  from.cam = run.gate.cam;
  run.gate.cam = view.cam;
  // The arrays are traded, never copied: the host's, which its resizes write, stays the main
  // view's, and a resize during a capture is not undone when the main view comes back.
  from.viewport = setup.viewport;
  setup.viewport = view.viewport;
  views.active = view;
  run.gate.viewReplaced();
  run.cutEpoch++;
}

/** Releases the targets of `view`, which is not the main one; the main view is drawn again. */
export function releaseWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  useWebgpuView(rt, view);
  releaseTargets(rt);
  useWebgpuView(rt, rt.views.main);
}
