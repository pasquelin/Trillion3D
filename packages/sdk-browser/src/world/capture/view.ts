import type { RenderBackend } from '../../backend/types.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { createFrameComposer } from '../render/compose.ts';
import { createWebglRenderTarget } from '../../webgl/core/renderTarget.ts';

type Inputs = {
  camera: HostCamera;
  context?: WebGL2RenderingContext;
  active: () => RenderBackend;
  check: () => void;
  compose: ReturnType<typeof createFrameComposer>;
  /** Asks the loop for the view again; nothing where the host leads the frames. */
  redraw: () => void;
};

/**
 * The composed image of the session's camera at `width × height`, bottom row first, drawn
 * OFFSCREEN: the page's canvas keeps its size and its image. An engine that presents its own
 * surface renders the frame aside (`captureColorView`); an engine the host composes draws into a
 * render target of that size, the camera shaped to it for that one draw and put back.
 */
export function createExplorerCaptureView(inputs: Inputs) {
  const { camera, context, active: getActive, check, compose, redraw } = inputs;
  return async (width: number, height: number): Promise<Uint8Array> => {
    check();
    const active = getActive();
    // The view is put back without what frames build up — the effect chain, the temporal
    // accumulation, the water —: the loop draws it again, gone idle or not.
    if (active.captureColorView)
      return active.captureColorView(camera, { width, height }).finally(redraw);
    const gl = context;
    if (!gl) throw new Error('CAPTURE_VIEW_UNSUPPORTED');
    const target = createWebglRenderTarget(gl, width, height);
    const aspect = camera.aspect;
    // An orthographic camera's matrix is its box, whatever the shape: only a perspective one
    // is recomposed at the target's aspect.
    const reshape = (value: number) => {
      camera.aspect = value;
      if (!camera.orthographic) camera.updateProjectionMatrix();
    };
    try {
      reshape(width / height);
      active.render(camera);
      // The engine's image alone, at the capture's size: the chain's targets keep the view's.
      compose(active, target, false, false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    } finally {
      reshape(aspect);
      target.dispose();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  };
}
