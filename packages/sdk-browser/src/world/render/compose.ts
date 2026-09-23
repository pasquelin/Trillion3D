import { linearToSrgb } from '../../../../sdk-core/src/index.ts';
import { DEFAULT_TONE_MAPPING } from '../../../../sdk-core/src/scene/core/environment.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { createHostDrawCamera, readHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { createBackendPresenter } from './composeSurface.ts';
import { createHeldFrame } from './heldFrame.ts';
import type { SceneColour } from '../../webgl/cluster/lights.ts';
import {
  bindWebglTarget,
  type HostDrawOutput,
  type WebglRenderTarget,
} from '../../webgl/core/renderTarget.ts';

/**
 * Composes one engine's frame on the host surface or on a render target — the one place that
 * knows how an engine's image reaches either. It binds the destination, then copies the surface
 * an engine presented on its own canvas, or clears with the engine's background and asks the
 * engine to draw its whole image there, keeping the copy of the last complete frame that spares
 * a redraw. Nothing here belongs to a rendering library.
 */
export function createFrameComposer(gl: WebGL2RenderingContext, camera: HostCamera) {
  const heldFrame = createHeldFrame(gl);
  const present = createBackendPresenter(gl);
  const drawCamera = createHostDrawCamera();
  const output: HostDrawOutput = {
    toneMapped: true,
    toneMapping: DEFAULT_TONE_MAPPING,
    framebuffer: null,
    width: 0,
    height: 0,
  };
  /** The engine's background, sRGB-encoded like everything the destinations store; depth and
   *  stencil cleared with it, the whole viewport. */
  const clear = (background: SceneColour) => {
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
   * `reuse` is false where the kept frame is not this engine's: a fallback takes over the image
   * from the engine that failed, and putting back what is kept would show that engine's last
   * frame. It draws, and what it draws is kept in turn.
   */
  const compose = (backend: RenderBackend, target: WebglRenderTarget | null, reuse = true) => {
    const { width, height } = bindWebglTarget(gl, target);
    if (present(backend)) return;
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
    output.toneMapping = backend.sceneToneMapping?.() ?? DEFAULT_TONE_MAPPING;
    output.framebuffer = target?.framebuffer ?? null;
    output.width = width;
    output.height = height;
    clear(backend.scene.background as SceneColour);
    backend.drawHostGeometry(readHostDrawCamera(drawCamera, camera), output);
    if (!target) heldFrame.keep(width, height);
  };
  compose.dispose = () => {
    present.dispose();
    heldFrame.dispose();
  };
  return compose;
}
