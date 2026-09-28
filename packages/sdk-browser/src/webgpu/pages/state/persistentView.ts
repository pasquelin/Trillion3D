import type { HostCamera } from '../../../camera/world.ts';
import { rigViewTemporal } from '../../../taa/prepare.ts';
import { releaseSettledCapture } from '../io/captureAside.ts';
import { renderWebgpuPages } from '../render/render.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { PresentRect } from '../../../gpu/core/presentAt.ts';
import { createWebgpuView, type WebgpuView } from './view.ts';
import { onView } from './viewSwitch.ts';

/**
 * The persistent-view base (#1097), which `world.addView` wraps (#1138): the capture's view
 * (`../io/captureAside.ts`), kept and drawn every frame beside the main one from a camera of its
 * own, and presented at `rect` of the canvas. It holds its own cut, targets, held frame, Hi-Z
 * pyramid, anti-aliasing history and effect chain; it is no capture, so texture feedback, the
 * effect chain, water and the particles it draws are all its own. The main view is drawn first
 * each frame: its presentation clears the canvas, the views' keep what it shows.
 */
export async function addWebgpuView(rt: WebgpuPagesRuntime, rect: PresentRect) {
  const view = createWebgpuView(rect.width, rect.height);
  view.rect = { ...rect };
  rt.views.persistent.push(view);
  await rigViewTemporal(rt, view);
  return view;
}

/** Draws `view` from `camera` at its rectangle's shape, then the main view is drawn again; the
 *  frame counts as held only when the main view's and this one's both are. */
export function renderWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView, camera: HostCamera) {
  const { run, capture } = rt,
    rect = view.rect;
  if (!rect || !rt.views.persistent.includes(view)) throw new Error('VIEW_RELEASED');
  if (capture.capturing) throw new Error('SURFACE_CAPTURE_BUSY');
  const mainHeld = run.frameHeld;
  onView(rt, view, () => renderWebgpuPages(rt, camera, rect.width / rect.height));
  run.frameHeld &&= mainHeld;
}

/** `view` leaves: once the device has answered what it asked, its targets, pyramid, history and
 *  effect chain are released, and its cut leaves the residency's union. */
export async function removeWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const at = rt.views.persistent.indexOf(view);
  if (at < 0) return;
  rt.views.persistent.splice(at, 1);
  await releaseSettledCapture(rt, view);
}
