import { linearToSrgb } from '../../../../sdk-core/src/index.ts';
import {
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../../sdk-core/src/scene/core/environment.ts';
import type { EffectChain, EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { createHostDrawCamera, readHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { createBackendPresenter } from './composeSurface.ts';
import { createHeldFrame } from './heldFrame.ts';
import { createWebglGuideDraw } from '../../guides/guideGl.ts';
import { DEFAULT_PIXEL_RATIO } from '../../backend/common.ts';
import type { GuideSet } from '../../guides/guideSet.ts';
import type { SceneColour } from '../../webgl/cluster/lights.ts';
import {
  bindWebglTarget,
  type HostDrawOutput,
  type WebglRenderTarget,
} from '../../webgl/core/renderTarget.ts';
import { createWebglEffects, type WebglEffectOutput } from '../../effects/webglEffects.ts';

const NONE: readonly EffectPass[] = [];

/** The world's effect chain as the composer draws it: `shown` is false in a diagnostic view,
 *  which shows the engine's image as it is. */
export type ComposedChain = { chain: EffectChain; shown: () => boolean };

/**
 * Composes one engine's frame on the host surface or on a render target — the one place that
 * knows how an engine's image reaches either. It binds the destination, then copies the surface
 * an engine presented on its own canvas, or clears with the engine's background and asks the
 * engine to draw its whole image there, keeping the copy of the last complete frame that spares
 * a redraw. With an effect chain that holds passes, the engine draws linear radiance into the
 * chain's target instead, and the chain brings its image to the destination
 * (`../../effects/webglEffects.ts`); the copy kept is the chain's image, and a chain changed
 * since it was kept is drawn again. The page's `guides` are drawn over the image the destination
 * got, the chain's included, before that copy is kept, at the host's `pixelRatio`; a change to
 * them spares no redraw.
 * Nothing here belongs to a rendering library.
 */
export function createFrameComposer(
  gl: WebGL2RenderingContext,
  camera: HostCamera,
  layers: { effects?: ComposedChain; guides?: GuideSet; pixelRatio?: () => number } = {},
) {
  const { effects: composed, guides, pixelRatio = () => DEFAULT_PIXEL_RATIO } = layers;
  const heldFrame = createHeldFrame(gl);
  const guideDraw = createWebglGuideDraw(gl, pixelRatio);
  let guidesDrawn = guides?.revision ?? 0;
  const present = createBackendPresenter(gl);
  const effects = composed && createWebglEffects(gl);
  const drawCamera = createHostDrawCamera();
  const output: HostDrawOutput = {
    toneMapped: true,
    toneMapping: DEFAULT_TONE_MAPPING,
    framebuffer: null,
    width: 0,
    height: 0,
    linear: false,
  };
  const display: WebglEffectOutput & { background: [number, number, number] } = {
    toneMapped: true,
    toneCurve: 0,
    background: [0, 0, 0],
  };
  let keptRevision = 0;
  /** The engine's background, sRGB-encoded like everything the destinations store. */
  const encode = (background: SceneColour) => {
    const { r, g, b } = background?.isColor ? background : { r: 0, g: 0, b: 0 };
    display.background[0] = linearToSrgb(r);
    display.background[1] = linearToSrgb(g);
    display.background[2] = linearToSrgb(b);
  };
  /** Clears with the encoded background; depth and stencil cleared with it, the whole viewport. */
  const clear = () => {
    const [r, g, b] = display.background;
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(r, g, b, 1);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  };
  /** The passes this frame draws: none without a chain, in a diagnostic view, on a destination
   *  that takes the engine's image alone, or on a context that cannot hold the targets. */
  const passesOf = (wanted: boolean) => {
    if (!composed) return NONE;
    const passes = composed.chain.stage('before-tone-mapping');
    // An emptied chain gives its targets back; one kept aside for a capture keeps them.
    if (!passes.length) effects!.release();
    return passes.length && wanted && composed.shown() && effects!.supported() ? passes : NONE;
  };
  /**
   * `reuse` is false where the kept frame is not this engine's: a fallback takes over the image
   * from the engine that failed, and putting back what is kept would show that engine's last
   * frame. It draws, and what it draws is kept in turn. `chained` is false for a capture, which
   * takes the engine's image without the chain, as the WebGPU capture does.
   */
  const compose = (
    backend: RenderBackend,
    target: WebglRenderTarget | null,
    reuse = true,
    chained = true,
  ) => {
    const { width, height } = bindWebglTarget(gl, target);
    if (present(backend)) return;
    const revision = composed?.chain.revision ?? 0;
    const guidesHeld = !guides || guides.revision === guidesDrawn;
    if (
      reuse &&
      guidesHeld &&
      backend.frameHeld === true &&
      !target &&
      heldFrame.holds(width, height) &&
      keptRevision === revision
    ) {
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
    const passes = passesOf(chained);
    const linear = passes.length ? effects!.begin(passes, width, height) : null;
    output.linear = !!linear;
    output.framebuffer = (linear ?? target)?.framebuffer ?? null;
    output.width = width;
    output.height = height;
    encode(backend.scene.background as SceneColour);
    if (!linear) clear();
    backend.drawHostGeometry(readHostDrawCamera(drawCamera, camera), output);
    if (linear) {
      display.toneMapped = output.toneMapped;
      display.toneCurve = TONE_MAPPING_RANK[output.toneMapping];
      effects!.end(passes, target, display);
      // The guides land where the chain drew, over the depth it carried.
      output.framebuffer = target?.framebuffer ?? null;
    }
    if (guides) {
      guidesDrawn = guides.revision;
      guideDraw.draw(guides, drawCamera, output);
    }
    if (target) return;
    heldFrame.keep(width, height);
    keptRevision = revision;
  };
  /** Bytes of the chain's targets on this context. */
  compose.effectBytes = () => effects?.bytes ?? 0;
  compose.dispose = () => {
    present.dispose();
    heldFrame.dispose();
    effects?.dispose();
    guideDraw.dispose();
  };
  return compose;
}
