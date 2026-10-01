import { pendingViewReleases } from './releases.ts';
import { createViewMetrics } from './metrics.ts';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { withViewDisplay } from './display.ts';
import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts';
import type { BeautyMaterials } from '../../host/scene/graphDiagnostic.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { RenderBackend, MeasuredWorldOptions } from '../../backend/types.ts';
import type { PresentRect } from '../../gpu/core/presentAt.ts';
import { viewRectangle } from '../../backend/view.ts';
import { createFrameComposer } from '../render/compose.ts';
import { createViewSurface } from './surface.ts';
import type { createExplorerDraw } from '../render/draw.ts';
import { pixelRatioOf } from '../../backend/common.ts';

type Inputs = {
  active: () => RenderBackend;
  check: () => void;
  draw: ReturnType<typeof createExplorerDraw>;
  gl?: WebGL2RenderingContext;
  options: MeasuredWorldOptions;
  compose: ReturnType<typeof createFrameComposer>;
  beauty: BeautyMaterials;
  diagnostic: () => DiagnosticMode;
};

/** The session's views draw in its one frame, before metrics and after one arrivals drain. */
export function createExplorerViews({
  active,
  check,
  draw,
  gl,
  options,
  compose,
  beauty,
  diagnostic,
}: Inputs) {
  const sides = new Set<{ camera: HostCamera; draw(): void; dispose(): void; bytes(): number }>();
  const metrics = createViewMetrics();
  const releases = pendingViewReleases();
  const mainSurface = gl ? createViewSurface(gl) : undefined;
  let mainRect: PresentRect | null = null,
    disposed = false;
  let mainMask: ((draw: () => void) => void) | undefined;
  async function add(camera: HostCamera, rect: PresentRect, mask = (draw: () => void) => draw()) {
    check();
    const backend = active();
    if (!backend.addView) throw new Error(`MULTI_VIEW_UNSUPPORTED:${backend.id}`);
    let at = viewRectangle(rect),
      mode: DiagnosticMode = 'beauty',
      background: number | undefined;
    let colour: Color | undefined;
    const view = await backend.addView(at);
    if (disposed) {
      await view.release();
      throw new Error('VIEW_RELEASED');
    }
    const surface = gl ? createViewSurface(gl) : undefined;
    const composer = gl
      ? createFrameComposer(gl, camera, {
          background: () => colour,
          effects: options.effects && {
            chain: options.effects,
            shown: () => mode === 'beauty',
            refused: options.effectsRefused,
          },
          guides: options.guides,
          pixelRatio: () => pixelRatioOf(options),
          particles: options.particles,
          particlesRefused: options.particlesRefused,
          particleStep: compose.particleStep,
        })
      : compose;
    let released = false;
    const row = {
      camera,
      draw() {
        if (active() !== backend) throw new Error('MULTI_VIEW_BACKEND_CHANGED');
        view.display?.(mode, background);
        mask(() =>
          view.render(camera, () => {
            const render = () =>
              draw(backend, surface?.target(at) ?? null, {
                camera,
                compose: composer,
                rendered: true,
              });
            if (surface) withViewDisplay(backend, beauty, mode, diagnostic(), render);
            else render();
            metrics.add(backend);
          }),
        );
        surface?.present(at);
      },
      bytes: () => (surface?.bytes() ?? 0) + (surface ? composer.effectBytes() : 0),
      dispose() {
        if (released) return;
        released = true;
        sides.delete(row);
        surface?.dispose();
        if (surface) composer.dispose();
        return releases.track(() => view.release());
      },
    };
    sides.add(row);
    return {
      display(next: DiagnosticMode, hex?: number) {
        if (next === 'materials' && backend.id !== 'webgpu-page-raster')
          throw new Error('VIEW_DIAGNOSTIC_UNSUPPORTED:materials');
        mode = next;
        if (background !== hex) colour = hex === undefined ? undefined : new Color(hex);
        background = hex;
      },
      resize(rect: PresentRect) {
        if (released) throw new Error('VIEW_RELEASED');
        const next = viewRectangle(rect);
        view.resize(next);
        at = next;
      },
      dispose: row.dispose,
    };
  }
  return {
    publishMetrics: metrics.publish,
    customized: () => !!mainRect || sides.size > 0,
    cameras: () => Array.from(sides, (side) => side.camera),
    /** Resizes the main view without adding a hidden full-canvas camera to the frame. */
    setRect(rect: PresentRect | null) {
      check();
      const next = rect ? viewRectangle(rect) : null;
      if (!active().setViewRect && next) throw new Error(`MULTI_VIEW_UNSUPPORTED:${active().id}`);
      active().setViewRect?.(next);
      mainRect = next;
    },
    setMask(mask: (draw: () => void) => void) {
      mainMask = mask;
    },
    add: (...args: Parameters<typeof add>) => releases.track(add(...args)),
    /** Returns false for the unchanged one-view path, so it pays no extra composition. */
    draw() {
      metrics.reset();
      if (!mainRect && !sides.size && !mainMask) return false;
      if (mainRect && gl) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      const drawMain = () =>
        draw(active(), mainRect ? (mainSurface?.target(mainRect) ?? null) : null);
      if (mainMask) mainMask(drawMain);
      else drawMain();
      metrics.add(active());
      if (mainRect) mainSurface?.present(mainRect);
      for (const view of sides) view.draw();
      return true;
    },
    bytes: () =>
      (mainSurface?.bytes() ?? 0) + Array.from(sides).reduce((sum, side) => sum + side.bytes(), 0),
    dispose() {
      disposed = true;
      for (const side of sides) side.dispose();
      mainSurface?.dispose();
      return releases.drain();
    },
  };
}
