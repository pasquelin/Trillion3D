import * as THREE from 'three';
import { presentationColorDiagnostic } from './presentationDiagnostic.ts';
import { DEFAULT_CLEAR_COLOR } from './backendCommon.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import type { ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerEmitters } from './explorerSession.ts';

type Inputs = Pick<ExplorerEmitters, 'diagnose'> & {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  options: ExplorerOptions;
  directGpu: boolean;
  presentBackend: (backend: RenderBackend) => boolean;
  state: Pick<ExplorerHostState, 'active'>;
  check: () => void;
};

export function createExplorerCapture(inputs: Inputs) {
  const {
    canvas,
    camera,
    renderer: ownedRenderer,
    options,
    directGpu,
    presentBackend,
    state,
    check,
    diagnose,
  } = inputs;
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
      const gl = ownedRenderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
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
      // Reading the composition means composing it first, by the same rule as a frame.
      if (!presentBackend(active)) ownedRenderer.render(active.scene, camera);
      const size = canvas.width * canvas.height * 4;
      captureSlot = (captureSlot + 1) % 3;
      if (capturePool[captureSlot].length !== size) capturePool[captureSlot] = new Uint8Array(size);
      const pixels = capturePool[captureSlot];
      const gl = ownedRenderer.getContext();
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
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
