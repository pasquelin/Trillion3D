import { tradeCamera, tradeView as trade } from '../../../frame/viewTrade.ts';
import { releaseTargets } from '../prepare/targets.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { VIEW_GPU_KEYS, VIEW_RUN_KEYS, VIEW_VIS_KEYS, type WebgpuView } from './view.ts';

/**
 * The one place a view is switched: every reader goes through the runtime groups, and they hold
 * `view`'s state once this returns. References are traded, nothing is allocated and the device is
 * asked nothing. Each view keeps its own held-frame witness and Hi-Z pyramid, so drawing one never
 * breaks another's hold; the host lists the last image published are read anew, since they
 * described another view's cut.
 */
export function useWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const { views, run, gpu, vis, setup } = rt,
    from = views.active;
  if (from === view) return;
  rt.lights?.plan.registerView(view === views.main ? undefined : view, rt.lights.store);
  trade(run, from.run, view.run, VIEW_RUN_KEYS);
  trade(gpu, from.gpu, view.gpu, VIEW_GPU_KEYS);
  trade(vis, from.vis, view.vis, VIEW_VIS_KEYS);
  // The arrays are traded, never copied: the host's, which its resizes write, stays the main
  // view's, and a resize during a capture is not undone when the main view comes back.
  from.viewport = setup.viewport;
  setup.viewport = view.viewport;
  views.active = view;
  rt.lights?.plan.useView(view === views.main ? undefined : view);
  tradeCamera(run.gate, from, view);
  from.hold = run.gate.useViewHold(view.hold);
  // Hi-Z dropped while `view` was aside: the pyramid it kept goes too.
  from.hiz = vis.gpuHiz?.swap(view.hiz);
  if (!vis.gpuHiz) view.hiz?.destroy();
  view.hiz = undefined;
  run.pendingHeld.cut = run.urlsHeld.cut = run.ranksHeld.cut = -1;
}

/** Runs `work` with `view` drawn — a late answer of the device lands on the view that asked for
 *  it — then draws again the view that was. */
export function onView<T>(rt: WebgpuPagesRuntime, view: WebgpuView, work: () => T) {
  const back = rt.views.active;
  useWebgpuView(rt, view);
  try {
    return work();
  } finally {
    useWebgpuView(rt, back);
  }
}

/** Releases the targets of `view`, which is not the main one, its own pyramid, history and effect
 *  chain, and takes its cut out of what the residency holds; the view drawn before is drawn
 *  again — the main one when it was `view` —, so a capture under way keeps its own. */
export function releaseWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const back = rt.views.active === view ? rt.views.main : rt.views.active;
  useWebgpuView(rt, view);
  releaseTargets(rt);
  useWebgpuView(rt, back);
  view.hiz?.destroy();
  view.hiz = undefined;
  view.gpu.temporal?.dispose();
  view.gpu.effects?.dispose();
  view.gpu.temporal = view.gpu.effects = undefined;
  rt.lights?.plan.removeView(view);
  rt.services.releaseView(view);
}
