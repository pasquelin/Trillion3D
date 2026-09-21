import * as THREE from 'three';
import { presentationColorDiagnostic } from './presentationDiagnostic.ts';
import { DEFAULT_CLEAR_COLOR } from './backendCommon.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import type { ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerEmitters } from './explorerSession.ts';
import type { createSceneDrawer } from './explorerDrawScene.ts';

type Inputs = Pick<ExplorerEmitters, 'diagnose'> & {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** The engine's context, where the pixels are read; absent on the direct WebGPU path. */
  context?: WebGL2RenderingContext;
  options: ExplorerOptions;
  directGpu: boolean;
  presentBackend: (backend: RenderBackend, srgbDestination?: boolean) => boolean;
  state: Pick<ExplorerHostState, 'active'>;
  check: () => void;
  drawScene?: ReturnType<typeof createSceneDrawer>;
};

export function createExplorerCapture(inputs: Inputs) {
  const {
    canvas,
    camera,
    renderer: ownedRenderer,
    context: gl,
    options,
    directGpu,
    presentBackend,
    state,
    check,
    diagnose,
    drawScene,
  } = inputs;
  const readPixels = (width: number, height: number, into: Uint8Array) => {
    if (!gl) throw new Error('The direct GPU path has no host surface to read');
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, into);
  };
  const capturePool = [new Uint8Array(0), new Uint8Array(0), new Uint8Array(0)];
  let captureSlot = 0;
  const presentationDiagnostics = new Set<string>(),
    visiblePresentationDiagnostics = new Set<string>();
  const logVisiblePresentation = () => {
    const active = state.active;
    if (visiblePresentationDiagnostics.has(active.id) || ownedRenderer.getRenderTarget() !== null)
      return;
    visiblePresentationDiagnostics.add(active.id);
    const pixel = new Uint8Array(4);
    try {
      readPixels(1, 1, pixel);
      diagnose('visible-presentation', 'First sample of the visible WebGL framebuffer', {
        kind: 'presentation',
        engine: active.id,
        ...presentationColorDiagnostic(
          pixel,
          1,
          1,
          options.clearColor ?? DEFAULT_CLEAR_COLOR,
          'default-webgl-framebuffer',
        ),
      });
    } catch (error) {
      diagnose('visible-presentation', 'Visible WebGL framebuffer read unavailable', {
        kind: 'error',
        engine: active.id,
        error: String(error),
        surface: 'default-webgl-framebuffer',
      });
    }
  };
  const capture = () => {
    check();
    const active = state.active;
    if (directGpu && active.capture) return active.capture();
    logVisiblePresentation();
    const previous = ownedRenderer.getRenderTarget();
    try {
      ownedRenderer.setRenderTarget(null);
      active.render(camera);
      // Reading the composition means composing it first, by the same rule as a frame. The
      // destination is the page's own framebuffer, which encodes nothing.
      if (!presentBackend(active)) {
        if (drawScene) drawScene(active, null, false);
        else ownedRenderer.render(active.scene, camera);
      }
      const size = canvas.width * canvas.height * 4;
      captureSlot = (captureSlot + 1) % 3;
      if (capturePool[captureSlot].length !== size) capturePool[captureSlot] = new Uint8Array(size);
      const pixels = capturePool[captureSlot];
      readPixels(canvas.width, canvas.height, pixels);
      if (!presentationDiagnostics.has(active.id)) {
        presentationDiagnostics.add(active.id);
        diagnose('presentation-capture', 'First sample of the final WebGL composition', {
          kind: 'presentation',
          engine: active.id,
          ...presentationColorDiagnostic(
            pixels,
            canvas.width,
            canvas.height,
            options.clearColor ?? DEFAULT_CLEAR_COLOR,
            'default-webgl-framebuffer',
          ),
        });
      }
      return pixels;
    } finally {
      ownedRenderer.setRenderTarget(previous);
    }
  };
  return capture;
}
