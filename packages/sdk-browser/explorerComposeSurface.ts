import { createCanvasBlit } from './webglCanvasBlit.ts';

/** What the copy needs of the host's renderer, and nothing more: the context it draws on, and the
 *  word that it must forget the state that copy left behind. */
type HostSurface = {
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
  resetState(): void;
};

/**
 * The one place that knows how an engine's image reaches the host surface. An engine that
 * presented its own canvas is copied from it by the engine's own program — no texture, material
 * or mesh of the host's rendering library takes part — and the call returns true. An engine that
 * hands over a scene is not this module's business: the call returns false and the host draws it.
 *
 * The copy is written into whatever framebuffer the host has bound, at the viewport it has set,
 * and the bytes go through unchanged — `srgbDestination` says how that framebuffer encodes what
 * is written to it, and the image is already display encoded. It goes around the renderer's cache, so
 * that renderer is told to forget it afterwards — which also unbinds the framebuffer, and the
 * caller re-asserts its render target before its next draw.
 *
 * The program lives as long as the context does and leaves with it, like the held frame beside it.
 */
export function createBackendPresenter(host: HostSurface) {
  let blit: ReturnType<typeof createCanvasBlit> | undefined;
  return (backend: { readonly presentedSurface?: HTMLCanvasElement }, srgbDestination = false) => {
    const surface = backend.presentedSurface;
    if (!surface) return false;
    const gl = host.getContext() as WebGL2RenderingContext;
    // A lost context takes the program, the texture and the buffer with it. Nothing can be drawn
    // until it comes back, and what comes back is rebuilt: the names of a dead context never
    // work again.
    if (gl.isContextLost()) {
      blit = undefined;
      return true;
    }
    if (!blit) {
      blit = createCanvasBlit(gl);
      gl.canvas.addEventListener('webglcontextlost', () => (blit = undefined), { once: true });
    }
    try {
      blit.draw(surface, srgbDestination);
    } finally {
      // Even a failed copy left the host renderer's state cache wrong: it is told so either way.
      host.resetState();
    }
    return true;
  };
}
