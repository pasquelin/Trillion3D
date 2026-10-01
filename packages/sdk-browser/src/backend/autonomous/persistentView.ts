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

/** The main and persistent entry points share exactly the same renderer. */
export function webglViewApi(
  views: ReturnType<typeof createWebglViews>,
  render: (camera: HostCamera) => void,
) {
  return {
    render,
    setViewRect: (rect: PresentRect | null) =>
      views.setMainSize(rect ? [rect.width, rect.height] : null),
    addView: async (rect: PresentRect) => addWebglView(views, rect, render),
  };
}
