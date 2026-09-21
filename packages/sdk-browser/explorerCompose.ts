import { linearToSrgb } from '../sdk-core/index.ts';
import type { HostDrawOutput, RenderBackend } from './backendTypes.ts';
import { createHostDrawCamera, readHostDrawCamera, type HostCamera } from './cameraWorld.ts';
import { createHeldFrame } from './explorerHeldFrame.ts';
import { bindWebglTarget, type WebglRenderTarget } from './webglRenderTarget.ts';

/** The clear colour an engine declares on its scene, read by shape: linear components. */
type Background = { isColor?: boolean; r: number; g: number; b: number } | null | undefined;

/**
 * Composes one engine's frame on the host surface or on a render target: binds the target,
 * clears it with the engine's background, asks the engine to draw its whole image there, and
 * keeps the copy of the last complete frame that spares a redraw. The path of every engine that
 * does not present a surface of its own; nothing here belongs to a rendering library.
 */
export function createFrameComposer(gl: WebGL2RenderingContext, camera: HostCamera) {
  const heldFrame = createHeldFrame(gl);
  const drawCamera = createHostDrawCamera();
  const output: HostDrawOutput = {
    encodeSrgb: true,
    toneMapped: true,
    framebuffer: null,
    width: 0,
    height: 0,
  };
  /**
   * The engine's background, as its scene declares it, sRGB-encoded: the drawing buffer and the
   * targets store display bytes. Depth and stencil are cleared with it, the whole viewport.
   */
  const clear = (background: Background) => {
    const { r, g, b } = background?.isColor ? background : { r: 0, g: 0, b: 0 };
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(linearToSrgb(r), linearToSrgb(g), linearToSrgb(b), 1);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  };
  /**
   * A held frame cannot differ from the previous one — the engine just said so — and is put
   * back in one copy, the scene not drawn again; with none kept at this size, the first or after
   * a resize, it is drawn then kept.
   *
   * `reuse` is false where the kept frame is not this engine's: a fallback takes over the image
   * from the engine that failed, and putting back what is kept would show that engine's last
   * frame. It draws, and what it draws is kept in turn.
   */
  const compose = (backend: RenderBackend, target: WebglRenderTarget | null, reuse = true) => {
    bindWebglTarget(gl, target);
    const width = target?.width ?? gl.drawingBufferWidth,
      height = target?.height ?? gl.drawingBufferHeight;
    if (reuse && backend.frameHeld === true && !target && heldFrame.holds(width, height)) {
      heldFrame.present();
      return;
    }
    if (!backend.drawHostGeometry) throw new Error(`HOST_DRAW_UNSUPPORTED:${backend.id}`);
    // The display chain of the engine's view, the same rule for every engine and every
    // destination: an unlit scene composes by identity, from linear to sRGB and nothing else
    // (P6); as soon as a light exists, exposure and the filmic curve come back, last links of
    // the chain (P4). A target thus holds what the page would show.
    output.toneMapped = backend.sceneLit?.() !== false;
    output.framebuffer = target?.framebuffer ?? null;
    output.width = width;
    output.height = height;
    clear(backend.scene.background as Background);
    backend.drawHostGeometry(readHostDrawCamera(drawCamera, camera), output);
    if (!target) heldFrame.keep(width, height);
  };
  compose.dispose = heldFrame.dispose;
  return compose;
}
