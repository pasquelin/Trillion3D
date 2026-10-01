import type { HostCamera } from '../../../camera/world.ts';
import type { BackendView } from '../../../backend/view.ts';
import type { PresentRect } from '../../../gpu/core/presentAt.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { renderWebgpuPages } from '../render/render.ts';
import {
  addWebgpuView,
  removeWebgpuView,
  renderWebgpuView,
  resizeWebgpuView,
  mainViewRectangle,
  displayWebgpuView,
} from './persistentView.ts';

/** The primary render keeps the GPU cut; additional views use the persistent-view engine. */
export function webgpuViewApi(rt: WebgpuPagesRuntime) {
  return {
    setViewRect: mainViewRectangle(rt),
    render(camera: HostCamera) {
      const rect = rt.views.main.rect;
      renderWebgpuPages(rt, camera, rect ? rect.width / rect.height : undefined);
    },
    async addView(rect: PresentRect): Promise<BackendView> {
      const view = await addWebgpuView(rt, rect);
      return {
        render: (camera, compose) => renderWebgpuView(rt, view, camera, compose),
        resize: (rect) => resizeWebgpuView(rt, view, rect),
        display: (mode, background) => displayWebgpuView(rt, view, mode, background),
        release: () => removeWebgpuView(rt, view),
      };
    },
  };
}
