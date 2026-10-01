import type { HostCamera } from '../../../camera/world.ts';
import { rigViewTemporal } from '../../../taa/prepare.ts';
import { releaseSettledCapture } from '../io/captureAside.ts';
import { renderWebgpuPages } from '../render/render.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { PresentRect } from '../../../gpu/core/presentAt.ts';
import { createWebgpuView, type WebgpuView } from './view.ts';
import { onView } from './viewSwitch.ts';
import { viewRectangle } from '../../../backend/view.ts';

/**
 * The persistent-view base (#1097), which `world.addView` wraps (#1138): the capture's view
 * (`../io/captureAside.ts`), kept and drawn every frame beside the main one from a camera of its
 * own, and presented at `rect` of the canvas. It holds its own cut, targets, held frame, Hi-Z
 * pyramid, anti-aliasing history and effect chain; it is no capture, so texture feedback, the
 * effect chain, water and the particles it draws are all its own. The main view is drawn first
 * each frame: its presentation clears the canvas, the views' keep what it shows.
 */
export async function addWebgpuView(rt: WebgpuPagesRuntime, rect: PresentRect) {
  // Whole canvas pixels: the present packs the origin into an integer (`presentAt.ts`).
  const at = viewRectangle(rect);
  const view = createWebgpuView(at.width, at.height);
  view.run.clearColor = rt.run.clearColor;
  rt.lights.plan.registerView(view, rt.lights.store);
  view.rect = at;
  rt.views.persistent.push(view);
  try {
    await rigViewTemporal(rt, view);
  } catch (error) {
    // Never handed to the caller, it would never leave: it leaves now.
    await removeWebgpuView(rt, view);
    throw error;
  }
  return view;
}

/** Display choices change this view's witness alone, without invalidating another camera's image. */
export function displayWebgpuView(
  rt: WebgpuPagesRuntime,
  view: WebgpuView,
  diagnostic: WebgpuView['run']['diagnostic'],
  background?: number,
) {
  onView(rt, view, () => {
    const clear = background ?? rt.views.main.run.clearColor;
    if (rt.run.diagnostic === diagnostic && rt.run.clearColor === clear) return;
    rt.run.diagnostic = diagnostic;
    rt.run.clearColor = clear;
    rt.run.gate.viewReplaced();
  });
}

/** Draws `view` from `camera` at its rectangle's shape, then the main view is drawn again; the
 *  frame counts as held only when the main view's and this one's both are. */
export function renderWebgpuView(
  rt: WebgpuPagesRuntime,
  view: WebgpuView,
  camera: HostCamera,
  compose?: () => void,
) {
  const { run, capture } = rt,
    rect = view.rect;
  if (!rect || !rt.views.persistent.includes(view)) throw new Error('VIEW_RELEASED');
  if (capture.capturing) throw new Error('SURFACE_CAPTURE_BUSY');
  const mainHeld = run.frameHeld;
  onView(rt, view, () => {
    renderWebgpuPages(rt, camera, rect.width / rect.height);
    compose?.();
  });
  run.frameHeld &&= mainHeld;
}

/** Changes a live view's size in place; its next frame grants targets at the new dimensions. */
export function resizeWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView, rect: PresentRect) {
  if (!rt.views.persistent.includes(view)) throw new Error('VIEW_RELEASED');
  view.rect = viewRectangle(rect);
  view.viewport![0] = view.rect.width;
  view.viewport![1] = view.rect.height;
}

/** Keeps the original host viewport for the default full-canvas main image. */
export function mainViewRectangle(rt: WebgpuPagesRuntime) {
  const viewport = rt.views.main.viewport;
  return (rect: PresentRect | null) => {
    const main = rt.views.main;
    main.rect = rect ? viewRectangle(rect) : undefined;
    main.viewport = main.rect ? [main.rect.width, main.rect.height] : viewport;
    if (rt.views.active === main) rt.setup.viewport = main.viewport;
  };
}

/** `view` leaves: once the device has answered what it asked, its targets, pyramid, history and
 *  effect chain are released, and its cut leaves the residency's union. */
export async function removeWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const at = rt.views.persistent.indexOf(view);
  if (at < 0) return;
  rt.views.persistent.splice(at, 1);
  await releaseSettledCapture(rt, view);
}
