import { createCanvasBlit } from './webglCanvasBlit.ts';

/** What the copy needs of the host's renderer, and nothing more: the context it draws on, and the
 *  word that it must forget the state that copy left behind. */
type HostSurface = {
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
  resetState(): void;
};

/**
 * Host composition of an engine that presented its own surface. The engine wrote its image with
 * WebGPU on its canvas; the host surface is WebGL2, so the image is copied by the engine's own
 * program — no texture, material or mesh of the host's rendering library takes part in it.
 *
 * The copy is written into whatever framebuffer the host has bound, at the viewport it has set,
 * and the bytes go through unchanged: the presented image is already display encoded, and a
 * second colour conversion would brighten it. The host's renderer caches the state it set, so it
 * is told to forget it afterwards. The program lives as long as the context does, and leaves with
 * it — like the held frame drawn beside it.
 */
export function createSurfaceComposer(host: HostSurface) {
  let blit: ReturnType<typeof createCanvasBlit> | undefined;
  return (surface: HTMLCanvasElement) => {
    blit ??= createCanvasBlit(host.getContext() as WebGL2RenderingContext);
    blit.draw(surface);
    host.resetState();
  };
}
