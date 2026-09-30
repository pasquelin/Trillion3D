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
import type { GuideSet } from '../../guides/guideSet.ts';
import type { SceneColour } from '../../webgl/cluster/lights.ts';
import {
  bindWebglTarget,
  clearWebglTarget,
  type HostDrawOutput,
  type WebglRenderTarget,
} from '../../webgl/core/renderTarget.ts';
import { createWebglEffects, type WebglEffectOutput } from '../../effects/webglEffects.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import type { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts';
import { webglParticleStep } from '../../fluids/particleCode.ts';
import { anyMoving } from '../../particles/poolStates.ts';
import { createComposeScale } from './renderScale.ts';

const NONE: readonly EffectPass[] = [];

/** The world's effect chain as the composer draws it: `shown` is false in a diagnostic view,
 *  which shows the engine's image as it is; `refused` hears, on each frame it keeps the chain
 *  off, the mode the engine's `linearRefusal` names. */
export type ComposedChain = {
  chain: EffectChain;
  shown: () => boolean;
  refused?: (blending: Blending) => void;
};

/**
 * Composes one engine's frame on the host surface or on a render target — the one place that
 * knows how an engine's image reaches either. It binds the destination, then copies the surface
 * an engine presented on its own canvas, or clears with the engine's background and asks the
 * engine to draw its whole image there, keeping the copy of the last complete frame that spares a
 * redraw. With an effect chain that holds passes, the engine draws linear radiance into the
 * chain's target instead, and the chain brings its image to the destination
 * (`../../effects/webglEffects.ts`); the copy kept is the chain's image, and a chain changed since
 * it was kept is drawn again. The page's `guides` are drawn over the image the destination got,
 * the chain's included, before that copy is kept, at the host's `pixelRatio`; a change to them
 * spares no redraw. The world's `particles` step before, and draw over the engine's image before
 * the chain, on every image drawn here: when they move, the image is drawn, never kept
 * (`../../fluids/particleCode.ts`). A refusal never fails the session: the pools are refused
 * by name, `particlesRefused` hearing why once, and the frame goes on without them. An engine with
 * a render scale draws both below the display, resampled before the chain (`./renderScale.ts`).
 * Nothing here belongs to a rendering library.
 */
export function createFrameComposer(
  gl: WebGL2RenderingContext,
  camera: HostCamera,
  layers: {
    effects?: ComposedChain;
    particles?: readonly ParticlePool[];
    particlesRefused?: (reason: string) => void;
  } & ({ guides?: undefined } | { guides: GuideSet; pixelRatio: () => number }) = {},
) {
  const { effects: composed, particles = [] } = layers;
  const heldFrame = createHeldFrame(gl);
  let stepped: ReturnType<typeof webglParticleStep>;
  const guideDraw = createWebglGuideDraw(gl);
  let guidesDrawn = layers.guides?.revision ?? 0;
  const present = createBackendPresenter(gl),
    scaled = createComposeScale(gl);
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
  /** `keptParticles`: the kept frame shows particles, never put back, pools let go since included. */
  let keptRevision = 0,
    keptParticles = false;
  /** The engine's background, sRGB-encoded like everything the destinations store. */
  const encode = (background: SceneColour) => {
    const { r, g, b } = background?.isColor ? background : { r: 0, g: 0, b: 0 };
    display.background[0] = linearToSrgb(r);
    display.background[1] = linearToSrgb(g);
    display.background[2] = linearToSrgb(b);
  };
  /** The passes this frame draws: none without a chain, in a diagnostic view, on a destination
   *  that takes the engine's image alone, on a context that cannot hold the targets, or on a frame
   *  the engine's linear draw cannot hold (`linearRefusal`, read from the draw's own walk of its
   *  graph, which the draw then reuses) — every surface is still drawn. */
  const passesOf = (backend: RenderBackend, wanted: boolean) => {
    if (!composed) return NONE;
    const passes = composed.chain.stage('before-tone-mapping');
    // An emptied chain gives its targets back; one kept aside for a capture keeps them.
    if (!passes.length) effects!.release();
    if (!passes.length || !wanted || !composed.shown() || !effects!.supported()) return NONE;
    const refused = backend.linearRefusal?.();
    if (!refused) return passes;
    composed.refused?.(refused);
    return NONE;
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
    pass?: HostDrawOutput['pass'],
  ) => {
    const { width, height } = bindWebglTarget(gl, target);
    if (present(backend)) return;
    const moved = anyMoving(particles);
    // Made by a pool once its code arrived, then run with none left: it frees a pool's targets.
    if (particles.length) stepped ??= webglParticleStep(gl, particles, layers.particlesRefused);
    if (stepped?.run(particles)) bindWebglTarget(gl, target);
    const revision = composed?.chain.revision ?? 0;
    const guidesHeld = !layers.guides || layers.guides.revision === guidesDrawn,
      scale = scaled.scaleOf(backend, target, chained);
    if (
      reuse &&
      guidesHeld &&
      !moved &&
      !keptParticles &&
      backend.frameHeld === true &&
      !target &&
      heldFrame.holds(width, height) &&
      keptRevision === revision &&
      scaled.holds(scale)
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
    const passes = passesOf(backend, chained);
    const linear = passes.length ? effects!.begin(passes, width, height) : null;
    output.linear = !!linear;
    if (pass) output.pass = pass;
    else delete output.pass;
    output.framebuffer = (linear ?? target)?.framebuffer ?? null;
    output.width = width;
    output.height = height;
    encode(backend.scene.background as SceneColour);
    // Drawn below the display, the image is resampled over every pixel of it: only its own target
    // is cleared.
    const clear = linear ? undefined : display.background;
    if (!scaled.begin(backend, output, scale, clear) && clear) clearWebglTarget(gl, clear);
    backend.drawHostGeometry(readHostDrawCamera(drawCamera, camera), output);
    stepped?.draw(particles, drawCamera, output);
    scaled.end(output);
    if (linear) {
      display.toneMapped = output.toneMapped;
      display.toneCurve = TONE_MAPPING_RANK[output.toneMapping];
      effects!.end(passes, target, display);
      // The guides land where the chain drew, over the depth it carried.
      output.framebuffer = target?.framebuffer ?? null;
    }
    if (layers.guides) {
      guidesDrawn = layers.guides.revision;
      guideDraw.draw(layers.guides, drawCamera, output, layers.pixelRatio());
    }
    if (target) return;
    pass?.('Trillion3D WebGL2 held frame copy');
    heldFrame.keep(width, height);
    keptRevision = revision;
    keptParticles = moved;
    scaled.keep();
  };
  /** Bytes of the chain's targets, the particles' depth copy and the target an image drawn below
   *  the display is drawn in, on this context. */
  compose.effectBytes = () => (effects?.bytes ?? 0) + (stepped?.bytes() ?? 0) + scaled.bytes();
  compose.dispose = () => {
    present.dispose();
    scaled.dispose();
    heldFrame.dispose();
    effects?.dispose();
    guideDraw.dispose();
    stepped?.dispose();
  };
  return compose;
}
