import type { RenderBackend } from './backendTypes.ts';
import type { HostCamera } from './cameraWorld.ts';
import type { createFrameComposer } from './explorerCompose.ts';
import { createWebglRenderTarget } from './webglRenderTarget.ts';

type Inputs = {
  camera: HostCamera;
  context?: WebGL2RenderingContext;
  active: () => RenderBackend;
  check: () => void;
  compose: ReturnType<typeof createFrameComposer>;
};

/**
 * The composed image of the session's camera at `width × height`, bottom row first, drawn
 * OFFSCREEN: the page's canvas keeps its size and its image. An engine that presents its own
 * surface renders the frame aside (`captureColorView`); an engine the host composes draws into a
 * render target of that size, the camera shaped to it for that one draw and put back.
 */
export function createExplorerCaptureView(inputs: Inputs) {
  const { camera, context, active: getActive, check, compose } = inputs;
  return async (width: number, height: number): Promise<Uint8Array> => {
    check();
    const active = getActive();
    if (active.captureColorView) return active.captureColorView(camera, { width, height });
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
      compose(active, target, false);
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
