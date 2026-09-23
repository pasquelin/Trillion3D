import { createPivotControls, trackPivotGestures } from './pivot.ts';
import type { ControlCamera, PivotCameraControls } from './types.ts';

/**
 * PLANAR PAN-ZOOM, the flat view: the camera never turns. Whatever direction it was pointing
 * in when the controller was made is the direction it keeps, and every gesture slides the
 * view in the plane the camera faces or moves it closer to that plane — a plan, an elevation,
 * a map. Any drag pans, the wheel and a pinch zoom between `minDistance` and `maxDistance`,
 * and the arrow keys pan by a fixed step for a viewer who has no pointer.
 *
 * `rotateSpeed` is inherited from the pivot contract and does nothing here: there is no
 * rotation to speed up. `enablePan` and `enableZoom` switch the two gestures that exist.
 */
export interface PanZoomCameraControls extends PivotCameraControls {
  /** Pixels a single arrow-key press pans by. */
  keyPanPixels: number;
}

/** Where each arrow key takes the view, in screen directions. */
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function createPanZoomCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): PanZoomCameraControls {
  const core = createPivotControls(camera, surface);
  const api = Object.assign(core.api, { keyPanPixels: 24 });
  trackPivotGestures(surface, core.base, core.panBy, core.panBy, core.dolly);
  // Keys are acted on as they arrive, never polled: a held arrow repeats through the
  // platform's own auto-repeat, and a still view is never woken by a key nobody pressed.
  core.base.listen<KeyboardEvent>(surface.ownerDocument, 'keydown', (event) => {
    const step = ARROWS[event.code];
    if (!step || event.ctrlKey || event.metaKey) return;
    core.panBy(-step[0] * api.keyPanPixels, -step[1] * api.keyPanPixels);
  });
  return api;
}
