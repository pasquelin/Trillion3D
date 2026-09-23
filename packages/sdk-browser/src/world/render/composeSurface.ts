import { createCanvasBlit } from '../../webgl/core/canvasBlit.ts';
import { boundToContext } from '../../webgl/core/contextBound.ts';

/**
 * The one place that knows how an engine's image reaches the host surface. An engine that
 * presented its own canvas is copied from it by the engine's own program — no texture, material
 * or mesh of any rendering library takes part — and the call returns true. An engine that draws
 * on the host surface itself is not this module's business: the call returns false and the
 * composition host asks it to draw.
 *
 * The copy is written into whatever framebuffer the host has bound, at the viewport it has set,
 * and the bytes go through unchanged: the image is already display encoded, and so is what the
 * host's drawing buffer and its targets store.
 *
 * The program lives as long as the context does and leaves with it, like the held frame beside it.
 * An engine that has withdrawn its surface — its device lost — is treated like one that never
 * had it: the call returns false and the host draws, never the canvas of a dead device.
 */
export function createBackendPresenter(gl: WebGL2RenderingContext) {
  const blit = boundToContext(
    gl,
    () => createCanvasBlit(gl),
    (program) => program.dispose(),
  );
  const present = (backend: { readonly presentedSurface?: HTMLCanvasElement }) => {
    const surface = backend.presentedSurface;
    if (!surface) return false;
    // A lost context draws nothing until it comes back; the program is rebuilt on the next copy.
    blit.current()?.draw(surface);
    return true;
  };
  present.dispose = blit.dispose;
  return present;
}
