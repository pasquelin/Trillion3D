import { viewDiagnostic } from './display.ts';
import { families } from '../../host/families.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { viewRectangle } from '../../backend/view.ts';
import { copyWorldCamera } from '../core/worldCamera.ts';
import { worldControlsHandle } from '../core/worldControlsHandle.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import { createViewInput } from './input.ts';

import type { WorldViewOptions, ViewRect } from './worldViews.ts';
export function createWorldView(
  options: WorldViewOptions,
  context: {
    input: ReturnType<typeof createViewInput>;
    adopt: (camera: Camera) => Camera;
    invalidate: () => void;
    physical: (rect: ViewRect) => ViewRect;
    withMask: (nodes: readonly Object3D[], draw: () => void) => void;
    session: () => MeasuredWorld | null;
    remove: (handle: object) => void;
    failed: (error: unknown) => void;
  },
) {
  const { input, adopt, invalidate, physical, withMask } = context;
  let camera = adopt(options.camera),
    rect = viewRectangle(options.rect),
    released = false;
  let diagnosticGeneration = 0;
  let mode = 'beauty',
    background: number | null = null;
  let exclude = [...(options.exclude ?? [])];
  let attached: Awaited<ReturnType<MeasuredWorld['views']['add']>> | undefined;
  let host: MeasuredWorld['camera'] | undefined,
    generation = 0;
  const region = input.region(() => rect);
  const controls = worldControlsHandle(
    options.controls ?? 'none',
    () => camera,
    region.surface,
    invalidate,
  );
  let resolve!: () => void, reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void ready.catch(() => {});
  const follow = () => {
    if (!host || !attached) return;
    const at = physical(rect);
    copyWorldCamera(camera, host, at.width / at.height);
    attached.resize(at);
    attached.display(viewDiagnostic(mode), background ?? undefined);
  };
  const row = {
    controls,
    follow,
    closed() {
      generation++;
      attached = undefined;
      host = undefined;
    },
    async open(explorer: MeasuredWorld) {
      const own = ++generation;
      attached = undefined;
      host = explorer.camera.clone();
      copyWorldCamera(camera, host, rect.width / rect.height);
      try {
        const next = await explorer.views.add(host, physical(rect), (draw) =>
          withMask(exclude, draw),
        );
        if (released || generation !== own || context.session() !== explorer) return next.dispose();
        attached = next;
        resolve();
        invalidate();
      } catch (error) {
        reject(error);
        throw error;
      }
    },
    handle: {
      /** Settles when this view attaches to the current renderer; targets are admitted at draw time. */
      ready,
      /** The camera this view follows; replacing it keeps the same rectangle and residency identity. */
      get camera() {
        return camera;
      },
      set camera(next: Camera) {
        camera = adopt(next);
        controls.follow();
        invalidate();
      },
      /** The canvas rectangle in CSS pixels; resizing preserves the view's identity. */
      get rect(): ViewRect {
        return { ...rect };
      },
      set rect(next: ViewRect) {
        rect = viewRectangle(next);
        invalidate();
      },
      /** The controller receiving gestures inside this view's rectangle. */
      controls,
      /** Subtrees omitted from this camera and its shadows; other views remain unchanged. */
      get exclude(): readonly Object3D[] {
        return exclude.slice();
      },
      set exclude(nodes: readonly Object3D[]) {
        exclude = [...nodes];
        invalidate();
      },
      /** View-local background, 0xRRGGBB; null inherits the world's scene background. */
      get background(): number | null {
        return background;
      },
      set background(next: number | null) {
        if (next !== null && (!Number.isInteger(next) || next < 0 || next > 0xffffff))
          throw new RangeError('VIEW_BACKGROUND');
        background = next;
        invalidate();
      },
      /** A diagnostic of this camera alone, without changing the world's main view. */
      diagnostic: {
        /** Beauty by default; triangles is the per-triangle wireframe diagnostic. */
        get mode() {
          return mode;
        },
        set mode(next: string) {
          const diagnostic = viewDiagnostic(next),
            own = ++diagnosticGeneration;
          const apply = () => {
            if (released || own !== diagnosticGeneration) return;
            attached?.display(diagnostic, background ?? undefined);
            mode = next;
            invalidate();
          };
          if (next === 'beauty' || families.diagnostics.arrived) apply();
          else
            void families.diagnostics
              .load()
              .then(apply)
              .catch((error) => {
                if (!released && own === diagnosticGeneration) context.failed(error);
              });
        },
      },
      /** Removes this view, its controls and residency pins; the world and other views remain. */
      dispose() {
        if (released) return;
        released = true;
        generation++;
        diagnosticGeneration++;
        controls.dispose();
        region.dispose();
        attached?.dispose();
        context.remove(row.handle);
        reject(new Error('VIEW_RELEASED'));
        invalidate();
      },
    },
  };
  return row;
}
