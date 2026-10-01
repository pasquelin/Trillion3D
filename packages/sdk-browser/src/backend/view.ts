import type { HostCamera } from '../camera/world.ts';
import type { PresentRect } from '../gpu/core/presentAt.ts';
import type { DiagnosticMode } from '../../../sdk-core/src/index.ts';

/** Dimensions of a capture or persistent view, in physical pixels. */
export type ViewSize = { width: number; height: number };

/** A persistent camera cut sharing its backend's scene, page store and residency budget. */
export interface BackendView {
  /** Draws this camera, then composes while its cut is still selected; restores the former view. */
  render(camera: HostCamera, compose?: () => void): void;
  /** Changes the canvas rectangle, in physical pixels, without replacing this view's identity. */
  resize(rect: PresentRect): void;
  /** Changes view-local display settings; absent on a path whose host composes those settings. */
  display?(diagnostic: DiagnosticMode, background?: number): void;
  /** Releases the view and its residency pins; repeated releases are harmless. */
  release(): void | Promise<void>;
}

/** Validates before changing a live view: invalid input never destroys its previous image. */
export function viewRectangle(rect: PresentRect): PresentRect {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    throw new RangeError('VIEW_RECT: expected a positive rectangle within the canvas');
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

/** View capabilities of an engine sharing one scene and residency budget. */
export interface BackendViews {
  /** Adds a persistent view; absent means this backend cannot draw multiple views. */
  addView?(rect: PresentRect): Promise<BackendView>;
  /** Sets the main physical canvas rectangle; null restores the full canvas. */
  setViewRect?(rect: PresentRect | null): void;
}
