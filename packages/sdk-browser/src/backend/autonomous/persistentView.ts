import type { RenderBackend } from '../types.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { PresentRect } from '../../gpu/core/presentAt.ts';
import { viewRectangle, type BackendView } from '../view.ts';
import type { createWebglViews } from './views.ts';

/** Keeps the selected cut through composition: restoring it before drawing would draw another camera. */
function addWebglView(
  views: ReturnType<typeof createWebglViews>,
  rect: PresentRect,
  render: (camera: HostCamera) => void,
): BackendView {
  const at = viewRectangle(rect),
    view = views.create(at.width, at.height);
  let released = false;
  const check = () => {
    if (released) throw new Error('VIEW_RELEASED');
  };
  return {
    render(camera, compose) {
      check();
      const back = views.active;
      views.use(view);
      try {
        render(camera);
        compose?.();
      } finally {
        views.use(back);
      }
    },
    resize(rect) {
      check();
      const at = viewRectangle(rect);
      view.viewport![0] = at.width;
      view.viewport![1] = at.height;
    },
    release() {
      if (released) return;
      released = true;
      views.release(view);
    },
  };
}

/** The ordinary and immersive hosts share this view registry and its one residency pool. */
export function webglViewApi(views: ReturnType<typeof createWebglViews>, changed: () => void) {
  return {
    setXrActive(active: boolean) {
      if (active) views.suspendMain();
      changed();
    },
    async addView(this: Pick<RenderBackend, 'render'>, rect: PresentRect) {
      return addWebglView(views, rect, (camera) => this.render(camera));
    },
  };
}
