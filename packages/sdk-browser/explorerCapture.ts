import { presentationColorDiagnostic } from './presentationDiagnostic.ts';
import { DEFAULT_CLEAR_COLOR } from './backendCommon.ts';
import type { MeasuredWorldOptions } from './backendTypes.ts';
import type { HostCamera } from './cameraWorld.ts';
import type { createFrameComposer } from './explorerCompose.ts';
import type { ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerEmitters } from './explorerSession.ts';
import { bindWebglTarget } from './webglRenderTarget.ts';

type Inputs = Pick<ExplorerEmitters, 'diagnose'> & {
  canvas: HTMLCanvasElement;
  camera: HostCamera;
  /** The engine's context, where the composition lands and the pixels are read; absent on the
   *  direct WebGPU path. */
  context?: WebGL2RenderingContext;
  options: MeasuredWorldOptions;
  directGpu: boolean;
  state: Pick<ExplorerHostState, 'active' | 'measuring'>;
  check: () => void;
  compose: ReturnType<typeof createFrameComposer>;
};

export function createExplorerCapture(inputs: Inputs) {
  const { canvas, camera, options, directGpu, state, check, diagnose, compose } = inputs;
  const capturePool = [new Uint8Array(0), new Uint8Array(0), new Uint8Array(0)];
  let captureSlot = 0;
  const presentationDiagnostics = new Set<string>(),
    visiblePresentationDiagnostics = new Set<string>();
  const sample = (
    gl: WebGL2RenderingContext,
    phase: string,
    message: string,
    width: number,
    height: number,
    pixels: Uint8Array,
  ) => {
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    diagnose(phase, message, {
      kind: 'presentation',
      engine: state.active.id,
      ...presentationColorDiagnostic(
        pixels,
        width,
        height,
        options.clearColor ?? DEFAULT_CLEAR_COLOR,
        'default-webgl-framebuffer',
      ),
    });
  };
  // What the page shows is sampled once per engine, on the drawing buffer, and only when the
  // last frame went to it: a measured frame landed on its own target, and it is stale.
  const logVisiblePresentation = (gl: WebGL2RenderingContext) => {
    const active = state.active;
    if (visiblePresentationDiagnostics.has(active.id) || state.measuring) return;
    visiblePresentationDiagnostics.add(active.id);
    try {
      sample(
        gl,
        'visible-presentation',
        'First sample of the visible WebGL framebuffer',
        1,
        1,
        new Uint8Array(4),
      );
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
    const gl = inputs.context;
    if (!gl) throw new Error('The direct GPU path has no host surface to read');
    bindWebglTarget(gl, null);
    logVisiblePresentation(gl);
    // Reading the composition means composing it first, by the same rule as a frame, on the
    // page's own drawing buffer; the next frame binds its own target again.
    active.render(camera);
    compose(active, null, false);
    const size = canvas.width * canvas.height * 4;
    captureSlot = (captureSlot + 1) % 3;
    if (capturePool[captureSlot].length !== size) capturePool[captureSlot] = new Uint8Array(size);
    const pixels = capturePool[captureSlot];
    if (presentationDiagnostics.has(active.id))
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    else {
      presentationDiagnostics.add(active.id);
      sample(
        gl,
        'presentation-capture',
        'First sample of the final WebGL composition',
        canvas.width,
        canvas.height,
        pixels,
      );
    }
    return pixels;
  };
  return capture;
}
