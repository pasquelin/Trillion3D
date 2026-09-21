import { createCanvasBlit } from './webglCanvasBlit.ts';
import { boundToContext } from './webglContextBound.ts';

/**
 * The one place that knows how an engine's image reaches the host surface. An engine that
 * presented its own canvas is copied from it by the engine's own program — no texture, material
 * or mesh of any rendering library takes part — and the call returns true. An engine that draws
 * on the host surface itself is not this module's business: the call returns false and the
 * composition host asks it to draw.
 *
 * The copy is written into whatever framebuffer the host has bound, at the viewport it has set,
 * and the bytes go through unchanged — `srgbDestination` says how that framebuffer encodes what
 * is written to it, and the image is already display encoded.
 *
 * The program lives as long as the context does and leaves with it, like the held frame beside it.
 */
export function createBackendPresenter(gl: WebGL2RenderingContext) {
  const blit = boundToContext(
    gl,
    () => createCanvasBlit(gl),
    (program) => program.dispose(),
  );
  const present = (
    backend: { readonly presentedSurface?: HTMLCanvasElement },
    srgbDestination = false,
  ) => {
    const surface = backend.presentedSurface;
    if (!surface) return false;
    // A lost context draws nothing until it comes back; the program is rebuilt on the next copy.
    blit.current()?.draw(surface, srgbDestination);
    return true;
  };
  present.dispose = blit.dispose;
  return present;
}
