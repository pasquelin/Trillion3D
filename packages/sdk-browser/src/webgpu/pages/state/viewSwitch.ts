import { fitGpuHiz } from '../io/drops.ts';
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
 * they described, and the shared Hi-Z pyramid takes the size of the view's targets.
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
  from.viewport[0] = setup.viewport[0];
  from.viewport[1] = setup.viewport[1];
  setup.viewport[0] = view.viewport[0];
  setup.viewport[1] = view.viewport[1];
  views.active = view;
  run.gate.viewReplaced();
  run.cutEpoch++;
  if (gpu.colorTexture && gpu.device) fitGpuHiz(rt, gpu.device, ...gpu.targetSize);
}

/** Releases the targets of `view`, which is not the main one; the main view is drawn again. */
export function releaseWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  useWebgpuView(rt, view);
  releaseTargets(rt);
  useWebgpuView(rt, rt.views.main);
}
