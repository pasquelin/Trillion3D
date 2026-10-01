import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { PresentRect } from '../../gpu/core/presentAt.ts';
import { viewRectangle } from '../../backend/view.ts';
import { copyWorldCamera, type WorldControls } from '../core/worldCamera.ts';
import { cameraAdopter } from '../core/worldLink.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import { createViewInput } from './input.ts';
import { createWorldView } from './worldView.ts';

/** A view's rectangle in CSS pixels relative to the canvas's top-left corner. */
export type ViewRect = PresentRect;
/** A camera of the same scene, presented in another rectangle on the world's canvas. */
export interface WorldViewOptions {
  /** The camera through which this view sees the shared scene. */
  camera: Camera;
  /** The rectangle on the canvas, in CSS pixels. */
  rect: ViewRect;
  /** The controller receiving gestures inside this rectangle; none by default. */
  controls?: WorldControls;
  /** Subtrees omitted from this camera and its shadows; the shared scene is unchanged. */
  exclude?: readonly Object3D[];
}

/** Persistent page handles survive session reopening; their backend resources belong to each session. */
export function createWorldViews(
  canvas: HTMLCanvasElement,
  mainCamera: () => Camera,
  invalidate: () => void,
  withMask: (nodes: readonly Object3D[], draw: () => void) => void,
  failed: (cause: unknown) => void = () => {},
) {
  const input = createViewInput(canvas),
    adopt = cameraAdopter(invalidate);
  const rows = new Set<ReturnType<typeof createWorldView>>();
  let session: MeasuredWorld | null = null,
    mainRect: ViewRect | null = null,
    disposed = false;
  let mainExclude: readonly Object3D[] = [];
  const full = () => ({ x: 0, y: 0, width: canvas.clientWidth, height: canvas.clientHeight });
  const mainInput = input.region(() => mainRect ?? full());
  const physical = (rect: ViewRect) =>
    viewRectangle({
      x: (rect.x * canvas.width) / Math.max(1, canvas.clientWidth),
      y: (rect.y * canvas.height) / Math.max(1, canvas.clientHeight),
      width: (rect.width * canvas.width) / Math.max(1, canvas.clientWidth),
      height: (rect.height * canvas.height) / Math.max(1, canvas.clientHeight),
    });

  return {
    mainSurface: mainInput.surface,
    get exclude(): readonly Object3D[] {
      return mainExclude.slice();
    },
    set exclude(nodes: readonly Object3D[]) {
      mainExclude = [...nodes];
      invalidate();
    },
    get rect(): ViewRect | null {
      return mainRect && { ...mainRect };
    },
    set rect(rect: ViewRect | null) {
      mainRect = rect ? viewRectangle(rect) : null;
      invalidate();
    },
    addView(options: WorldViewOptions) {
      if (disposed) throw new Error('World disposed');
      const row = createWorldView(options, {
        input,
        adopt,
        invalidate,
        physical,
        withMask,
        failed,
        session: () => session,
        remove: (handle) => {
          for (const row of rows) if (row.handle === handle) rows.delete(row);
        },
      });
      rows.add(row);
      if (session) void row.open(session).catch(failed);
      invalidate();
      return row.handle;
    },
    closed() {
      session = null;
      for (const row of rows) row.closed();
    },
    async opened(explorer: MeasuredWorld) {
      session = explorer;
      explorer.views.setMask((draw) => withMask(mainExclude, draw));
      await Promise.all(Array.from(rows, (row) => row.open(explorer)));
    },
    beforeFrame() {
      if (!session) return;
      session.views.setRect(mainRect ? physical(mainRect) : null);
      if (mainRect) copyWorldCamera(mainCamera(), session.camera, mainRect.width / mainRect.height);
      for (const row of rows) row.follow();
    },
    step(delta: number) {
      for (const row of rows) if (row.controls.autoUpdate) row.controls.update(delta);
    },
    dispose() {
      disposed = true;
      session = null;
      for (const row of rows) row.handle.dispose();
      mainInput.dispose();
      input.dispose();
    },
  };
}

/** A live camera, rectangle and controller of a world's shared scene. */
export type WorldView = ReturnType<ReturnType<typeof createWorldViews>['addView']>;
