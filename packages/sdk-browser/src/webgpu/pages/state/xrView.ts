import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { XrGpuEye } from '../../../world/xr/renderTypes.ts';
import { onView } from './viewSwitch.ts';
import { renderWebgpuPages } from '../render/render.ts';
import { metricsOf } from '../io/metrics.ts';
import { addWebgpuView, removeWebgpuView } from './persistentView.ts';

/** An XR eye keeps the ordinary view's TAA, Hi-Z and effects; only presentation is borrowed. */
export async function createXrGpuEye(
  rt: WebgpuPagesRuntime,
  width: number,
  height: number,
): Promise<XrGpuEye> {
  const view = await addWebgpuView(rt, { x: 0, y: 0, width, height });
  let disposed = false,
    revision = -1;
  return {
    draw(camera, target) {
      if (disposed) throw new Error('XR_VIEW_RELEASED');
      if (revision !== rt.context.stereo?.revision) {
        revision = rt.context.stereo?.revision ?? -1;
        rt.run.gate.resourcesChanged();
      }
      const presenter = rt.gpu.presenter;
      if (!presenter) throw new Error('WEBGPU_UNAVAILABLE');
      const rect = view.rect!;
      rect.width = view.viewport[0] = target.viewport.width;
      rect.height = view.viewport[1] = target.viewport.height;
      presenter.borrow(target);
      try {
        return onView(rt, view, () => {
          renderWebgpuPages(rt, camera, rect.width / rect.height);
          return metricsOf(rt);
        });
      } finally {
        presenter.borrow();
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await removeWebgpuView(rt, view);
    },
  };
}
